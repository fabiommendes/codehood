import { canInvite } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import {
	type ActingOpts,
	type CreateAs,
	type FindOneAs,
	ForbiddenError,
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

export type InviteWithCount = Invite & { _count: { redemptions: number } };

type RedeemableInvite = {
	kind: InviteKind;
	email: string | null;
	expiresAt: Date;
	maxUses: number | null;
	_count: { redemptions: number };
};

class InviteService
	implements
		CreateAs<CreateInviteInput, CreateInviteResult>,
		FindOneAs<FindInviteBy, InviteWithCount>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Create a new invite, returning the plaintext token and the invite row.
	 */
	async create(
		input: CreateInviteInput,
		opts: ActingOpts,
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
		opts: ActingOpts,
	): Promise<InviteWithCount | null> {
		const client = opts.tx ?? this.prisma;
		return client.invite.findUnique({
			where: { tokenHash: hashToken(filter.token) },
			include: { _count: { select: { redemptions: true } } },
		});
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
