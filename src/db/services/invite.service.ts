import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import {
	inviteCreate,
	inviteFilter,
	invitePK,
	inviteSchema,
	inviteUpdate,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import type { FillUndefineds } from "@/typing";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { courseRefWhere, valueOrNotFound } from "../utils";

export type { InviteId } from "@/core/schemas";

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
export type InvitePK = z.infer<typeof invitePK>;
export type InviteFilter = z.infer<typeof inviteFilter>;
export type InviteUpdate = z.infer<typeof inviteUpdate>;

type DbInvite = Prisma.InviteGetPayload<{ include: typeof inviteInclude }>;

/** The creator, redemption count and course every returned invite carries. */
const inviteInclude = {
	_count: { select: { redemptions: true } },
	createdBy: { select: { username: true, name: true } },
	course: {
		select: { disciplineSlug: true, instructorId: true, editionSlug: true },
	},
} satisfies Prisma.InviteInclude;

export class InviteService extends CrudBase<{
	entity: Invite;
	pkFilter: InvitePK;
	create: InviteCreate;
	filter: InviteFilter;
	update: InviteUpdate;
	upsert: false;
}> {
	/**
	 * Creates an invite, returning the plaintext token and the invite row.
	 *
	 * An invite bound to a course requires the right to enrol into that
	 * course, so the course is loaded first and checked with the invite's
	 * role.
	 *
	 * `createdBy` in `input` is only honoured for `SYSTEM` calls, which have
	 * no actor to derive it from; a `SYSTEM` call without it is rejected. Any
	 * other caller has it derived from `opts.actor` and silently ignored if
	 * sent.
	 */
	@Validate({
		service: true,
		returns: inviteSchema,
		args: [undefined, inviteCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: InviteCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Invite> {
		const course = input.course
			? await tx.course.findUnique({
					where: courseRefWhere(input.course),
					select: { id: true, instructor: { select: { username: true } } },
				})
			: null;
		if (input.course && !course) {
			throw new NotFound("course");
		}
		ensurePerm(opts.actor, "invite.create", {
			invitedRole: input.invitedRole,
			course,
		});
		const createdById =
			opts.actor === SYSTEM ? input.createdBy?.username : opts.actor.username;
		if (createdById === undefined) {
			throw new InvalidData({
				createdBy: [
					{
						code: "missing",
						message: "A SYSTEM call must supply createdBy explicitly.",
					},
				],
			});
		}
		const token = generateToken();
		const invite = await tx.invite.create({
			data: {
				publicId: generateToken(9),
				tokenHash: hashToken(token),
				kind: input.kind,
				email: input.email,
				invitedRole: input.invitedRole,
				courseId: course?.id,
				maxUses: input.maxUses ?? null,
				expiresAt: new Date(
					Date.now() + (input.expiresInMs ?? DEFAULT_EXPIRY_MS),
				),
				createdById,
			},
			include: inviteInclude,
		});
		const result = fromDb(invite);
		result.token = token; // only here, never in the database
		return result;
	}

	/**
	 * Finds a single invite by its raw token or by its id.
	 *
	 * A token lookup is not actor-filtered: the raw token is the credential,
	 * and looking one up is how the invite-acceptance flow establishes what
	 * the redeemer is allowed to become. An id lookup is filtered, because
	 * ids are sequential and would otherwise let any account walk every
	 * invite's email, role, course and creator.
	 */
	@Validate({
		service: true,
		returns: inviteSchema.nullable(),
		args: [undefined, invitePK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: InvitePK,
		opts: ServiceOptsWithoutTx,
	): Promise<Invite | null> {
		const by = filter as FillUndefineds<InvitePK>;
		const where = by.token
			? { tokenHash: hashToken(by.token) }
			: by.publicId
				? { publicId: by.publicId }
				: { id: by.id };

		const invite = await tx.invite.findUnique({
			where,
			include: inviteInclude,
		});
		if (invite == null) return null;
		if (!by.token) ensurePerm(opts.actor, "invite.read", invite);

		return fromDb(invite);
	}

	/**
	 * Lists invites narrowed to what `actor` may see (see
	 * {@link inviteWhere}): every invite for an admin, self-issued ones
	 * for an instructor, none for a student.
	 *
	 * Never returns a token — only `tokenHash` is stored, so a lost link is
	 * reissued, not recovered.
	 */
	@Validate({
		service: true,
		returns: inviteSchema.array(),
		args: [undefined, inviteFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: InviteFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<Invite[]> {
		const course = filter.course
			? valueOrNotFound(
					"course",
					await tx.course.findUnique({
						where: courseRefWhere(filter.course),
						select: { id: true },
					}),
				)
			: null;

		const invites = await tx.invite.findMany({
			where: {
				AND: [
					filter.createdBy ? { createdById: filter.createdBy } : {},
					filter.kind ? { kind: filter.kind } : {},
					course ? { courseId: course.id } : {},
					filter.active ? { expiresAt: { gt: new Date() } } : {},
					inviteWhere(opts.actor),
				],
			},
			include: inviteInclude,
			orderBy: { createdAt: "desc" },
		});
		const result = invites.map(fromDb);
		for (const invite of result) ensurePerm(opts.actor, "invite.read", invite);
		return result;
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
		args: [undefined, invitePK, inviteUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: InvitePK,
		fields: InviteUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<Invite> {
		const invite = await this.findOne(filter, { ...opts, tx });

		if (!invite || !hasPerm(opts.actor, "invite.update", invite)) {
			throw new NotAllowed("invite.update");
		}

		const updated = await tx.invite.update({
			where: { id: invite.id },
			data: {
				expiresAt: fields.expiresAt,
				maxUses: fields.maxUses,
			},
			include: inviteInclude,
		});
		return fromDb(updated);
	}

	// No upsert: `create` mints a token and returns a token-plus-entity
	// wrapper, not the entity — re-minting a fresh invite token on every sync
	// is wrong. Left unimplemented; CrudBase.upsertTx already throws.

	/**
	 * Revokes an invite.
	 *
	 * Redemptions cascade with it, which removes the record that an account
	 * came from this invite but never the account itself.
	 */
	@Validate({ service: true, args: [undefined, invitePK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: InvitePK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const invite = await this.findOne(filter, { ...opts, tx });
		if (!invite || !hasPerm(opts.actor, "invite.delete", invite)) {
			throw new NotAllowed("invite.delete");
		}

		await tx.invite.delete({ where: { id: invite.id } });
	}

	// TODO: validate this schema. Should not impose tasks on the caller.
	/**
	 * Redeems an invite for `username`, atomically re-checking expiry/capacity/email match.
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
		return this.$transaction(opts, async (tx, scoped) => {
			const invite = await this.findOne({ token }, { ...scoped, tx });
			if (!invite) throw new NotFound("invite", { id: token });

			const errorCode = this.checkRedeemable(invite, email);
			if (errorCode) throw new InviteError(errorCode);

			try {
				await tx.inviteRedemption.create({
					data: { inviteId: invite.id, username: username },
				});
			} catch {
				// InviteRedemption.username is unique: this user already redeemed
				// a (possibly different) invite.
				throw new InviteError("already_redeemed");
			}

			return invite;
		});
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

//
// Auxiliary functions
//

/** Prisma `where` fragment implementing the same rule as the `invite.read` permission. */
export function inviteWhere(actor: Actor): Prisma.InviteWhereInput {
	if (actor === SYSTEM || actor.role === "ADMIN") return {};
	if (actor.role === "STUDENT") return { id: { in: [] } };
	return { createdById: actor.username };
}

function fromDb(db: DbInvite): Invite {
	const {
		_count,
		createdById: _createdById,
		tokenHash: _tokenHash,
		course,
		...rest
	} = db;
	return {
		...rest,
		redemptions: _count.redemptions,
		course: course
			? {
					discipline: course.disciplineSlug,
					instructor: course.instructorId,
					edition: course.editionSlug,
				}
			: null,
	};
}
