import type { z } from "zod";
import { canInvite, canViewInvite, inviteVisibility } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import { NotAllowed, NotFound } from "@/core/error";
import { Validate } from "@/utils/validate";
import {
	inviteCreate,
	inviteFilter,
	invitePK,
	inviteSchema,
	inviteTokenFilter,
	inviteUpdate,
} from "../../core/schemas";
import type {
	Create,
	Delete,
	FindMany,
	FindOne,
	ServiceOpts,
	Update,
} from "../base-service";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";

export type { InviteId } from "../../core/schemas";

const DEFAULT_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type InviteErrorCode =
	| "not_found"
	| "expired"
	| "email_mismatch"
	| "exhausted"
	| "already_redeemed";

export class InviteError extends Error {
	constructor(public code: InviteErrorCode) {
		super(code);
	}
}

//
// Type definitions
//
export type InviteCreate = z.infer<typeof inviteCreate>;
export type Invite = z.infer<typeof inviteSchema>;
export type InviteTokenFilter = z.infer<typeof inviteTokenFilter>;
export type InvitePK = z.infer<typeof invitePK>;
export type InviteFilter = z.infer<typeof inviteFilter>;
export type InviteUpdate = z.infer<typeof inviteUpdate>;

type DbInvite = Prisma.InviteGetPayload<{ include: typeof inviteInclude }>;

/** The creator and redemption count every returned invite carries. */
const inviteInclude = {
	_count: { select: { redemptions: true } },
	createdBy: { select: { username: true, name: true } },
} satisfies Prisma.InviteInclude;

class InviteService
	implements
		Create<InviteCreate, Invite>,
		FindOne<InviteTokenFilter, Invite>,
		FindMany<InviteFilter, Invite>,
		Update<InvitePK, InviteUpdate, Invite>,
		Delete<InvitePK>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates an invite, returning the plaintext token and the invite row.
	 */
	@Validate({
		service: true,
		returns: inviteSchema,
		args: [inviteCreate],
	})
	async create(input: InviteCreate, opts: ServiceOpts): Promise<Invite> {
		if (!canInvite(opts.actor, input.invitedRole)) {
			throw new NotAllowed({ action: "create-invite" });
		}
		const client = opts.tx ?? this.prisma;
		const token = generateToken();
		const invite = await client.invite.create({
			data: {
				tokenHash: hashToken(token),
				kind: input.kind,
				email: input.email,
				invitedRole: input.invitedRole,
				courseId: input.courseId,
				maxUses: input.maxUses ?? null,
				expiresAt: new Date(
					Date.now() + (input.expiresInMs ?? DEFAULT_EXPIRY_MS),
				),
				createdById: input.createdBy.username,
			},
			include: inviteInclude,
		});
		const result = fromDb(invite);
		result.token = token; // only here, never in the database
		return result;
	}

	/**
	 * Finds a single invite by its token.
	 *
	 * Not actor-filtered: the raw token is the credential (see the invite's
	 * `tokenHash`), and looking one up is how the invite-acceptance flow
	 * establishes what the redeemer is allowed to become — there is nothing
	 * else to check `actor` against yet.
	 */
	@Validate({
		service: true,
		returns: inviteSchema.nullable(),
		args: [inviteTokenFilter],
	})
	async findOne(
		filter: InviteTokenFilter,
		opts: ServiceOpts,
	): Promise<Invite | null> {
		const client = opts.tx ?? this.prisma;

		const invite = await client.invite.findUnique({
			where: { tokenHash: hashToken(filter.token) },
			include: inviteInclude,
		});

		return invite == null ? null : fromDb(invite);
	}

	/**
	 * Lists invites narrowed to what `actor` may see (see
	 * {@link inviteVisibility}): every invite for an admin, self-issued ones
	 * for an instructor, none for a student.
	 *
	 * Never returns a token — only `tokenHash` is stored, so a lost link is
	 * reissued, not recovered.
	 */
	@Validate({
		service: true,
		returns: inviteSchema.array(),
		args: [inviteFilter],
	})
	async findMany(filter: InviteFilter, opts: ServiceOpts): Promise<Invite[]> {
		const client = opts.tx ?? this.prisma;
		const invites = await client.invite.findMany({
			where: {
				AND: [
					filter.createdById ? { createdById: filter.createdById } : {},
					filter.kind ? { kind: filter.kind } : {},
					filter.courseId ? { courseId: filter.courseId } : {},
					filter.active ? { expiresAt: { gt: new Date() } } : {},
					inviteVisibility(opts.actor),
				],
			},
			include: inviteInclude,
			orderBy: { createdAt: "desc" },
		});
		return invites.map(fromDb);
	}

	/**
	 * Extends an expiry or adjusts `maxUses`.
	 *
	 * Lowering `maxUses` below the redemptions already made is allowed and
	 * simply exhausts the invite; it never revokes an account that was
	 * already created.
	 */
	@Validate({
		service: true,
		returns: inviteSchema,
		args: [invitePK, inviteUpdate],
	})
	async update(
		filter: InvitePK,
		fields: InviteUpdate,
		opts: ServiceOpts,
	): Promise<Invite> {
		const client = opts.tx ?? this.prisma;

		const invite = await client.invite.findUnique({
			where: { id: filter.id },
			include: inviteInclude,
		});

		if (!invite || !canViewInvite(opts.actor, invite)) {
			throw new NotAllowed({ action: "update-invite" });
		}

		const updated = await client.invite.update({
			where: { id: filter.id },
			data: {
				expiresAt: fields.expiresAt,
				maxUses: fields.maxUses,
			},
			include: inviteInclude,
		});
		return fromDb(updated);
	}

	/**
	 * Revokes an invite.
	 *
	 * Redemptions cascade with it, which removes the record that an account
	 * came from this invite but never the account itself.
	 */
	@Validate({ service: true, args: [invitePK] })
	async delete(filter: InvitePK, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const invite = await client.invite.findUnique({
			where: { id: filter.id },
		});
		if (!invite || !canViewInvite(opts.actor, invite)) {
			throw new NotAllowed({ action: "delete-invite" });
		}
		await client.invite.delete({ where: { id: filter.id } });
	}

	// TODO: validate this schema. Should not impose tasks on the caller.
	/**
	 * Redeems an invite for `userId`, atomically re-checking expiry/capacity/email match.
	 *
	 * Callers should run {@link checkRedeemable} first to avoid doing
	 * invite-rejected work (e.g. creating the User row) — this transaction
	 * is the authoritative, race-safe check. Pass `tx` when the caller
	 * already has one open (e.g. `acceptInvite`, which creates the `User`,
	 * redeems the invite, and enrolls the student in one transaction so a
	 * redemption failure can't leave a User row with no invite behind it).
	 * Without one, this opens its own.
	 */
	redeem(token: string, username: string, email: string, opts: ServiceOpts) {
		const run = async (tx: PrismaTx) => {
			const invite = await this.findOne(
				{ token },
				{ tx: tx, actor: opts.actor },
			);
			if (!invite) throw new NotFound("invite", { id: token });

			const errorCode = this.checkRedeemable(invite, email);
			if (errorCode) throw new InviteError(errorCode);

			try {
				await tx.inviteRedemption.create({
					data: { inviteId: invite.id, userId: username },
				});
			} catch {
				// InviteRedemption.userId is unique: this user already redeemed
				// a (possibly different) invite.
				throw new InviteError("already_redeemed");
			}

			return invite;
		};

		return opts?.tx ? run(opts.tx) : this.prisma.$transaction(run);
	}

	/**
	 * Check if Invite is redeemable.
	 */
	checkRedeemable(invite: Invite, email: string): InviteErrorCode | undefined {
		if (invite.expiresAt < new Date()) return "expired";
		if (invite.kind === "PERSONAL" && invite.email !== email)
			return "email_mismatch";
		if (invite.maxUses !== null && invite.redemptions >= invite.maxUses)
			return "exhausted";
		return undefined;
	}
}

export const inviteService = new InviteService();

//
// Auxiliary functions
//

function fromDb(db: DbInvite): Invite {
	const { _count, createdById: _createdById, ...rest } = db;
	return { ...rest, redemptions: _count.redemptions };
}
