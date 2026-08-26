import { generateToken, hashToken } from "@/auth/token";
import type { Create, ServiceMethodOpts } from "./base-service";
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

class SessionService implements Create<CreateSession, CreateSessionResult> {
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
		opts?: ServiceMethodOpts,
	): Promise<CreateSessionResult> {
		const client = opts?.tx ?? this.prisma;
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
	 * expiry otherwise.
	 * */
	async validate(token: string, opts?: ServiceMethodOpts) {
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

	// TODO: refactor revoke methods to use the delete interface
	revokeByToken(token: string, opts?: ServiceMethodOpts) {
		const client = opts?.tx ?? this.prisma;
		return client.session.deleteMany({
			where: { tokenHash: hashToken(token) },
		});
	}

	revokeAllForUser(userId: number, opts?: ServiceMethodOpts) {
		const client = opts?.tx ?? this.prisma;
		return client.session.deleteMany({ where: { userId } });
	}
}

export const sessionService = new SessionService();
