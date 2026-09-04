import type { z } from "zod";
import { canInvite, canViewInvite, inviteVisibility } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import { NotAllowed } from "@/core/error";
import { Validate } from "@/utils/validate";
import {
	type CourseId,
	type InviteId,
	inviteCreate,
	inviteCreateResult,
	inviteFilter,
	inviteListItem,
	invitePK,
	type inviteSchema,
	inviteTokenFilter,
	inviteUpdate,
	inviteWithCount,
	type UserId,
} from "../../core/schemas";
import type {
	Create,
	Delete,
	FindMany,
	FindOne,
	ServiceOpts,
	Update,
} from "../base-service";
import { type PrismaClient, type PrismaTx, prisma } from "../client";

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
export type InviteWithCount = z.infer<typeof inviteWithCount>;
export type InviteListItem = z.infer<typeof inviteListItem>;
export type InviteCreateResult = z.infer<typeof inviteCreateResult>;
export type InviteTokenFilter = z.infer<typeof inviteTokenFilter>;
export type InvitePK = z.infer<typeof invitePK>;
export type InviteFilter = z.infer<typeof inviteFilter>;
export type InviteUpdate = z.infer<typeof inviteUpdate>;

type RedeemableInvite = {
	kind: Invite["kind"];
	email: string | null;
	expiresAt: Date;
	maxUses: number | null;
	_count: { redemptions: number };
};

class InviteService
	implements
		Create<InviteCreate, InviteCreateResult>,
		FindOne<InviteTokenFilter, InviteWithCount>,
		FindMany<InviteFilter, InviteListItem>,
		Update<InvitePK, InviteUpdate, InviteWithCount>,
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
		returns: inviteCreateResult,
		args: [inviteCreate],
	})
	async create(
		input: InviteCreate,
		opts: ServiceOpts,
	): Promise<InviteCreateResult> {
		const role = input.role ?? "STUDENT";
		if (!canInvite(opts.actor, role)) {
			throw new NotAllowed({ action: "create-invite" });
		}
		const client = opts.tx ?? this.prisma;
		const token = generateToken();
		const invite = await client.invite.create({
			data: {
				tokenHash: hashToken(token),
				kind: input.kind,
				email: input.email,
				role,
				courseId: input.courseId,
				maxUses: input.maxUses ?? null,
				expiresAt: new Date(
					Date.now() + (input.expiresInMs ?? DEFAULT_EXPIRY_MS),
				),
				createdById: input.createdById,
			},
		});
		return { token, invite: brand(invite) };
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
		returns: inviteWithCount.nullable(),
		args: [inviteTokenFilter],
	})
	async findOne(
		filter: InviteTokenFilter,
		opts: ServiceOpts,
	): Promise<InviteWithCount | null> {
		const client = opts.tx ?? this.prisma;
		const invite = await client.invite.findUnique({
			where: { tokenHash: hashToken(filter.token) },
			include: { _count: { select: { redemptions: true } } },
		});
		return invite && brand(invite);
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
		returns: inviteListItem.array(),
		args: [inviteFilter],
	})
	async findMany(
		filter: InviteFilter,
		opts: ServiceOpts,
	): Promise<InviteListItem[]> {
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
			include: {
				_count: { select: { redemptions: true } },
				createdBy: { select: { username: true, name: true } },
			},
			orderBy: { createdAt: "desc" },
		});
		return invites.map(brand);
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
		returns: inviteWithCount,
		args: [invitePK, inviteUpdate],
	})
	async update(
		filter: InvitePK,
		fields: InviteUpdate,
		opts: ServiceOpts,
	): Promise<InviteWithCount> {
		const client = opts.tx ?? this.prisma;
		const invite = await client.invite.findUnique({
			where: { id: filter.id },
			include: { _count: { select: { redemptions: true } } },
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
			include: { _count: { select: { redemptions: true } } },
		});
		return brand(updated);
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
	redeem(
		token: string,
		userId: number,
		email: string,
		opts?: { tx?: PrismaTx },
	) {
		const tokenHash = hashToken(token);

		const run = async (tx: PrismaTx) => {
			const invite = await tx.invite.findUnique({
				where: { tokenHash },
				include: { _count: { select: { redemptions: true } } },
			});

			if (!invite) throw new InviteError("not_found");

			const errorCode = checkRedeemable(invite, email);
			if (errorCode) throw new InviteError(errorCode);

			try {
				await tx.inviteRedemption.create({
					data: { inviteId: invite.id, userId },
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
}

export const inviteService = new InviteService();

/**
 * Pure check reused as a cheap pre-check (before creating a User) and as the
 * authoritative check inside {@link inviteService.redeem}'s transaction.
 */
export function checkRedeemable(
	invite: RedeemableInvite,
	email: string,
): InviteErrorCode | undefined {
	if (invite.expiresAt < new Date()) return "expired";
	if (invite.kind === "PERSONAL" && invite.email !== email)
		return "email_mismatch";
	if (invite.maxUses !== null && invite._count.redemptions >= invite.maxUses)
		return "exhausted";
	return undefined;
}

//
// Auxiliary functions
//

// Re-brand a raw invite row's numeric ids — a runtime no-op, since they
// already carry the right values, just not the branded type.
function brand<
	T extends { id: number; courseId: number | null; createdById: number },
>(
	invite: T,
): T & { id: InviteId; courseId: CourseId | null; createdById: UserId } {
	return invite as T & {
		id: InviteId;
		courseId: CourseId | null;
		createdById: UserId;
	};
}
