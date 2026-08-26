import { generateToken, hashToken } from "@/auth/token";
import type { Create, FindOne, ServiceMethodOpts } from "./base-service";
import {
	type Invite,
	type InviteKind,
	type PrismaClient,
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
	Create<CreateInviteInput, CreateInviteResult>,
	FindOne<FindInviteBy, InviteWithCount> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Create a new invite, returning the plaintext token and the invite row.
	 */
	async create(
		input: CreateInviteInput,
		opts?: ServiceMethodOpts,
	): Promise<CreateInviteResult> {
		const client = opts?.tx ?? this.prisma;
		const token = generateToken();
		const invite = await client.invite.create({
			data: {
				tokenHash: hashToken(token),
				kind: input.kind,
				email: input.email,
				role: input.role ?? "STUDENT",
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
	 * Single-email, single-use invite (instructor→student, admin→instructor).
	 */
	// TODO: refactor only create() exists. This should be a parameterized call.
	createPersonalCode(
		input: {
			email: string;
			role: Role;
			courseId?: number;
			createdById: number;
			expiresInMs?: number;
		},
		opts?: ServiceMethodOpts,
	) {
		return this.create({ ...input, kind: "PERSONAL", maxUses: 1 }, opts);
	}

	/**
	 * Reusable join code for a course; any STUDENT can redeem it until expiry/capacity.
	 */
	// TODO: refactor only create() exists. This should be a parameterized call.
	createClassroomCode(
		input: {
			courseId: number;
			createdById: number;
			maxUses?: number;
			expiresInMs?: number;
		},
		opts?: ServiceMethodOpts,
	) {
		return this.create({ ...input, kind: "CLASSROOM", role: "STUDENT" }, opts);
	}

	findOne(
		filter: FindInviteBy,
		opts?: ServiceMethodOpts,
	): Promise<InviteWithCount | null> {
		const client = opts?.tx ?? this.prisma;
		return client.invite.findUnique({
			where: { tokenHash: hashToken(filter.token) },
			include: { _count: { select: { redemptions: true } } },
		});
	}

	/**
	 * Redeems an invite for `userId`, atomically re-checking expiry/capacity/email match.
	 * Callers should run {@link checkRedeemable} first to avoid doing invite-rejected work
	 * (e.g. creating the User row) — this transaction is the authoritative, race-safe check.
	 */
	redeem(token: string, userId: number, email: string) {
		const tokenHash = hashToken(token);

		return this.prisma.$transaction(async (tx) => {
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
		});
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
