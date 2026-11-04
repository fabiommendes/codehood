import type { z } from "zod";
import { hasPerm } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import { NotAllowed } from "@/core/error";
import {
	type SessionId,
	sessionCreate,
	sessionCreateResult,
	sessionDeletePK,
	type sessionSchema,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import type { FillUndefineds } from "@/typing";
import { type PrismaTx, prisma } from "../client";

export type { SessionId } from "@/core/schemas";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

//
// Type definitions
//
export type SessionCreate = z.infer<typeof sessionCreate>;
export type Session = z.infer<typeof sessionSchema>;
export type SessionCreateResult = z.infer<typeof sessionCreateResult>;
export type SessionDeletePK = z.infer<typeof sessionDeletePK>;

/** The session service of `client` (the shared client by default). */
export const makeSessionService = defineService()(() => {
	/**
	 * Creates a new session for a user.
	 *
	 * This is the RESTful equivalent of logging in. There is no `upsert`:
	 * `create` mints a token and returns a token-plus-entity wrapper, and
	 * re-minting a fresh session token on every sync is wrong.
	 */
	const create = op({
		args: [sessionCreate],
		returns: sessionCreateResult,
		run: async (
			tx: PrismaTx,
			input: SessionCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<SessionCreateResult> => {
			if (!hasPerm(opts.actor, "session.manage", input.username)) {
				throw new NotAllowed("session.create");
			}
			const token = generateToken();
			const session = await tx.session.create({
				data: {
					tokenHash: hashToken(token),
					username: input.username,
					expiresAt: new Date(Date.now() + SESSION_TTL_MS),
				},
			});
			return { token, session: toSession(session) };
		},
	});

	/**
	 * Revokes the session matching `token`, or every session for `username`.
	 *
	 * A `token` deletion needs no actor check: holding the raw token is
	 * itself the proof of ownership (logout). A `username` deletion ("log out
	 * everywhere") is gated by the `session.manage` permission.
	 */
	const remove = op({
		args: [sessionDeletePK],
		run: async (
			tx: PrismaTx,
			filter: SessionDeletePK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const by = filter as FillUndefineds<SessionDeletePK>; // zod doesn't narrow to a single field, so we do it here
			if (by.token) {
				await tx.session.deleteMany({
					where: { tokenHash: hashToken(by.token) },
				});
			} else if (by.username) {
				if (!hasPerm(opts.actor, "session.manage", by.username)) {
					throw new NotAllowed("session.delete");
				}
				await tx.session.deleteMany({ where: { username: by.username } });
			}
		},
	});

	return { create, delete: remove };
});

/** The session service, as built by {@link makeSessionService}. */
export type SessionService = ReturnType<typeof makeSessionService>;

/**
 * Looks up the session for `token`, dropping it if expired and sliding its
 * expiry otherwise.
 *
 * A plain function rather than a service operation (ADR 0005): it takes no
 * actor because the raw token is the credential, and validating one is how an
 * actor's identity gets established in the first place. Returns the session
 * with its `user` joined in; the middleware assigns that straight to
 * `Astro.locals.user`.
 */
export async function validateSession(token: string, opts?: { tx?: PrismaTx }) {
	const client = opts?.tx ?? prisma;
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

// Convert a raw session row to the public-facing session type.
function toSession(session: {
	id: number;
	username: string;
	tokenHash: string;
	expiresAt: Date;
	createdAt: Date;
}): Session {
	return {
		id: session.id as SessionId,
		username: session.username,
		tokenHash: session.tokenHash,
		expiresAt: session.expiresAt,
		createdAt: session.createdAt,
	};
}
