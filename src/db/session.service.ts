import { canManageSessions } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import type { FillUndefineds } from "@/utils/types";
import {
	type Create,
	type Delete,
	ForbiddenError,
	type ServiceOpts,
} from "./base-service";
import { type PrismaClient, prisma, type Session } from "./client";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

export interface CreateSession {
	userId: number;
}

export interface CreateSessionResult {
	token: string;
	session: Session;
}

export type DeleteSessionFilter = FillUndefineds<
	{ token: string } | { userId: number }
>;

class SessionService
	implements
	Create<CreateSession, CreateSessionResult>,
	Delete<DeleteSessionFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a new session for user.
	 *
	 * This is the RESTful equivalent of logging in.
	 */
	async create(
		input: CreateSession,
		opts: ServiceOpts,
	): Promise<CreateSessionResult> {
		if (!canManageSessions(opts.actor, input.userId)) {
			throw new ForbiddenError();
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
		return { token, session };
	}

	/**
	 * Looks up the session for `token`, dropping it if expired and sliding its
	 * expiry otherwise. Not actor-gated: the raw token itself is the
	 * credential, and validating one is how an actor's identity gets
	 * established in the first place.
	 * */
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
	 * A `token` deletion needs no actor check — holding the raw token is
	 * itself the proof of ownership (logout). A `userId` deletion ("log out
	 * everywhere") is gated by {@link canManageSessions}.
	 */
	async delete(filter: DeleteSessionFilter, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		if (filter.token) {
			await client.session.deleteMany({
				where: { tokenHash: hashToken(filter.token) },
			});
		} else if (filter.userId) {
			if (!canManageSessions(opts.actor, filter.userId)) {
				throw new ForbiddenError();
			}
			await client.session.deleteMany({ where: { userId: filter.userId } });
		}
	}
}

export const sessionService = new SessionService();
