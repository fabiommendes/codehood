import { canInvite, canViewInvite, inviteVisibility } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import {
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	type Update,
} from "./base-service";
import {
	type Invite,
	type InviteKind,
	type PrismaClient,
	type PrismaTx,
	prisma,
	type Role,
} from "./client";

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

export interface CreateInviteInput {
	kind: InviteKind;
	email?: string;
	role?: Role;
	courseId?: number;
	maxUses?: number | null;
	createdById: number;
	expiresInMs?: number;
}

export interface CreateInviteResult {
	token: string;
	invite: Invite;
}

export interface FindInviteBy {
	token: string;
}

export interface FindInvitesBy {
	createdById?: number;
	kind?: InviteKind;
	courseId?: number;
	/** Only invites that have not expired yet. */
	active?: boolean;
}

export interface InviteFilter {
	id: number;
}

/**
 * The fields an invite may change without rewriting what it grants. `kind`,
 * `role`, and `email` are the contract the holder of the link already accepted;
 * editing them under an outstanding invite would silently change what redeeming
 * it does.
 */
export interface UpdateInvite {
	expiresAt?: Date;
	maxUses?: number | null;
}

export type InviteWithCount = Invite & { _count: { redemptions: number } };

/**
 * What a listing shows. Carries the creator, because "who issued this" is the
 * first thing an admin looking at somebody else's invite needs to know; the
 * single-invite `findOne` stays lean, since the redemption flow does not care.
 */
export type InviteListItem = InviteWithCount & {
	createdBy: { username: string; name: string };
};

type RedeemableInvite = {
	kind: InviteKind;
	email: string | null;
	expiresAt: Date;
	maxUses: number | null;
	_count: { redemptions: number };
};

class InviteService
	implements
	Create<CreateInviteInput, CreateInviteResult>,
	FindOne<FindInviteBy, InviteWithCount>,
	FindMany<FindInvitesBy, InviteListItem>,
	Update<InviteFilter, UpdateInvite, InviteWithCount>,
	Delete<InviteFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Create a new invite, returning the plaintext token and the invite row.
	 */
	async create(
		input: CreateInviteInput,
		opts: ServiceOpts,
	): Promise<CreateInviteResult> {
		const role = input.role ?? "STUDENT";
		if (!canInvite(opts.actor, role)) {
			throw new ForbiddenError();
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
		return { token, invite };
	}

	/**
	 * Not actor-filtered: the raw token is the credential (see the invite's
	 * `tokenHash`), and looking one up is how the invite-acceptance flow
	 * establishes what the redeemer is allowed to become — there is nothing
	 * else to check `actor` against yet.
	 */
	findOne(
		filter: FindInviteBy,
		opts: ServiceOpts,
	): Promise<InviteWithCount | null> {
		const client = opts.tx ?? this.prisma;
		return client.invite.findUnique({
			where: { tokenHash: hashToken(filter.token) },
			include: { _count: { select: { redemptions: true } } },
		});
	}

	/**
	 * Lists invites narrowed to what `actor` may see (see
	 * {@link inviteVisibility}): every invite for an admin, self-issued ones
	 * for an instructor, none for a student. Never returns a token — only
	 * `tokenHash` is stored, so a lost link is reissued, not recovered.
	 */
	findMany(
		filter: FindInvitesBy,
		opts: ServiceOpts,
	): Promise<InviteListItem[]> {
		const client = opts.tx ?? this.prisma;
		return client.invite.findMany({
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
	}

	/**
	 * Extends an expiry or adjusts `maxUses`. Lowering `maxUses` below the
	 * redemptions already made is allowed and simply exhausts the invite; it
	 * never revokes an account that was already created.
	 */
	async update(
		filter: InviteFilter,
		fields: UpdateInvite,
		opts: ServiceOpts,
	): Promise<InviteWithCount> {
		const client = opts.tx ?? this.prisma;
		const invite = await client.invite.findUnique({
			where: { id: filter.id },
			include: { _count: { select: { redemptions: true } } },
		});
		if (!invite || !canViewInvite(opts.actor, invite)) {
			throw new ForbiddenError();
		}
		return client.invite.update({
			where: { id: filter.id },
			data: {
				expiresAt: fields.expiresAt,
				maxUses: fields.maxUses,
			},
			include: { _count: { select: { redemptions: true } } },
		});
	}

	/**
	 * Revokes an invite. Redemptions cascade with it, which removes the record
	 * that an account came from this invite but never the account itself.
	 */
	async delete(filter: InviteFilter, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const invite = await client.invite.findUnique({
			where: { id: filter.id },
		});
		if (!invite || !canViewInvite(opts.actor, invite)) {
			throw new ForbiddenError();
		}
		await client.invite.delete({ where: { id: filter.id } });
	}

	/**
	 * Redeems an invite for `userId`, atomically re-checking expiry/capacity/email match.
	 * Callers should run {@link checkRedeemable} first to avoid doing invite-rejected work
	 * (e.g. creating the User row) — this transaction is the authoritative, race-safe check.
	 *
	 * Pass `tx` when the caller already has one open (e.g. `acceptInvite`, which creates the
	 * `User`, redeems the invite, and enrolls the student in one transaction so a redemption
	 * failure can't leave a User row with no invite behind it). Without one, this opens its own.
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
