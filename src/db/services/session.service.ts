import type { z } from "zod";
import { canManageSessions } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import { NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type SessionId,
	sessionCreate,
	sessionCreateResult,
	sessionDeletePK,
	type sessionSchema,
	type UserId,
} from "../../core/schemas";
import type { Create, Delete, ServiceOpts } from "../base-service";
import { type PrismaClient, prisma } from "../client";

export type { SessionId } from "../../core/schemas";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

//
// Type definitions
//
export type SessionCreate = z.infer<typeof sessionCreate>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionCreateResult = z.infer<typeof sessionCreateResult>;
export type SessionDeletePK = z.infer<typeof sessionDeletePK>;

class SessionService
	implements Create<SessionCreate, SessionCreateResult>, Delete<SessionDeletePK>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a new session for a user.
	 *
	 * This is the RESTful equivalent of logging in.
	 */
	@Validate({
		service: true,
		returns: sessionCreateResult,
		args: [sessionCreate],
	})
	async create(
		input: SessionCreate,
		opts: ServiceOpts,
	): Promise<SessionCreateResult> {
		if (!canManageSessions(opts.actor, input.userId)) {
			throw new NotAllowed({ action: "create-session" });
		}
		const client = opts.tx ?? this.prisma;
		const token = generateToken();
		const session = await client.session.create({
			data: {
				tokenHash: hashToken(token),
				userId: input.userId,
				expiresAt: new Date(Date.now() + SESSION_TTL_MS),
			},
		});
		return { token, session: brand(session) };
	}

	/**
	 * Looks up the session for `token`, dropping it if expired and sliding
	 * its expiry otherwise.
	 *
	 * Not actor-gated: the raw token itself is the credential, and
	 * validating one is how an actor's identity gets established in the
	 * first place. Returns the session with its `user` joined in — the
	 * middleware assigns that straight to `Astro.locals.user`.
	 */
	async validate(token: string, opts?: ServiceOpts) {
		const client = opts?.tx ?? this.prisma;
		const tokenHash = hashToken(token);
		const session = await client.session.findUnique({
			where: { tokenHash },
			include: { user: true },
		});
		if (!session) return null;

		if (session.expiresAt < new Date()) {
			await client.session.deleteMany({ where: { id: session.id } });
			return null;
		}

		const remaining = session.expiresAt.getTime() - Date.now();
		if (remaining < REFRESH_THRESHOLD_MS) {
			await client.session.update({
				where: { id: session.id },
				data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
			});
		}

		return session;
	}

	/**
	 * Revokes the session matching `token`, or every session for `userId`.
	 *
	 * A `token` deletion needs no actor check — holding the raw token is
	 * itself the proof of ownership (logout). A `userId` deletion ("log out
	 * everywhere") is gated by {@link canManageSessions}.
	 */
	@Validate({ service: true, args: [sessionDeletePK] })
	async delete(filter: SessionDeletePK, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const by = filter as FillUndefineds<SessionDeletePK>; // zod doesn't narrow to a single field, so we do it here
		if (by.token) {
			await client.session.deleteMany({
				where: { tokenHash: hashToken(by.token) },
			});
		} else if (by.userId) {
			if (!canManageSessions(opts.actor, by.userId)) {
				throw new NotAllowed({ action: "delete-session" });
			}
			await client.session.deleteMany({ where: { userId: by.userId } });
		}
	}
}

export const sessionService = new SessionService();

// Re-brand a raw session row's numeric ids — a runtime no-op, since they
// already carry the right values, just not the branded type.
function brand<T extends { id: number; userId: number }>(
	session: T,
): T & { id: SessionId; userId: UserId } {
	return session as T & { id: SessionId; userId: UserId };
}
