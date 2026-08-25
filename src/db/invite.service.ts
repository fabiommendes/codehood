import { generateToken, hashToken } from "@/auth/token";
import { type InviteKind, prisma, type Role } from "./client";

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

interface CreateInviteInput {
	kind: InviteKind;
	email?: string;
	role: Role;
	courseId?: number;
	maxUses?: number | null;
	createdById: number;
	expiresInMs?: number;
}

async function createInvite(input: CreateInviteInput) {
	const token = generateToken();
	const invite = await prisma.invite.create({
		data: {
			tokenHash: hashToken(token),
			kind: input.kind,
			email: input.email,
			role: input.role,
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

type RedeemableInvite = {
	kind: InviteKind;
	email: string | null;
	expiresAt: Date;
	maxUses: number | null;
	_count: { redemptions: number };
};

export const inviteService = {
	/**
	 * Single-email, single-use invite (instructor→student, admin→instructor).
	 */
	createPersonalCode(input: {
		email: string;
		role: Role;
		courseId?: number;
		createdById: number;
		expiresInMs?: number;
	}) {
		return createInvite({ ...input, kind: "PERSONAL", maxUses: 1 });
	},

	/**
	 * Reusable join code for a course; any STUDENT can redeem it until expiry/capacity.
	 */
	createClassroomCode(input: {
		courseId: number;
		createdById: number;
		maxUses?: number;
		expiresInMs?: number;
	}) {
		return createInvite({ ...input, kind: "CLASSROOM", role: "STUDENT" });
	},

	findByToken(token: string) {
		return prisma.invite.findUnique({
			where: { tokenHash: hashToken(token) },
			include: { _count: { select: { redemptions: true } } },
		});
	},

	/**
	 * Redeems an invite for `userId`, atomically re-checking expiry/capacity/email match.
	 * Callers should run {@link checkRedeemable} first to avoid doing invite-rejected work
	 * (e.g. creating the User row) — this transaction is the authoritative, race-safe check.
	 */
	redeem(token: string, userId: number, email: string) {
		const tokenHash = hashToken(token);

		return prisma.$transaction(async (tx) => {
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
	},
};

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
