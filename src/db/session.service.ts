import { generateToken, hashToken } from "@/auth/token";
import { prisma } from "./client";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2;

export const sessionService = {
	async create(userId: number) {
		const token = generateToken();
		const session = await prisma.session.create({
			data: {
				tokenHash: hashToken(token),
				userId,
				expiresAt: new Date(Date.now() + SESSION_TTL_MS),
			},
		});
		return { token, session };
	},

	/**
	 * Looks up the session for `token`, dropping it if expired and sliding its
	 * expiry otherwise.
	 * */
	async validate(token: string) {
		const tokenHash = hashToken(token);
		const session = await prisma.session.findUnique({
			where: { tokenHash },
			include: { user: true },
		});
		if (!session) return null;

		if (session.expiresAt < new Date()) {
			await prisma.session.deleteMany({ where: { id: session.id } });
			return null;
		}

		const remaining = session.expiresAt.getTime() - Date.now();
		if (remaining < REFRESH_THRESHOLD_MS) {
			await prisma.session.update({
				where: { id: session.id },
				data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
			});
		}

		return session;
	},

	revokeByToken(token: string) {
		return prisma.session.deleteMany({
			where: { tokenHash: hashToken(token) },
		});
	},

	revokeAllForUser(userId: number) {
		return prisma.session.deleteMany({ where: { userId } });
	},
};
