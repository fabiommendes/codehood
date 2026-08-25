import { generateToken, hashToken } from "@/auth/token";
import type { ApiKeyKind } from "./client";
import { prisma } from "./client";

export const apiKeyService = {
	async create(userId: number, name: string, kind: ApiKeyKind) {
		const token = generateToken();
		const apiKey = await prisma.apiKey.create({
			data: { keyHash: hashToken(token), name, kind, userId },
		});
		return { token, apiKey };
	},

	findById(id: number) {
		return prisma.apiKey.findUnique({ where: { id } });
	},

	/** 
	 * Looks up the key for `token` and stamps `lastUsedAt`. 
	 */
	async validate(token: string) {
		const keyHash = hashToken(token);
		const apiKey = await prisma.apiKey.findUnique({
			where: { keyHash },
			include: { user: true },
		});
		if (!apiKey) return null;
		await prisma.apiKey.update({
			where: { id: apiKey.id },
			data: { lastUsedAt: new Date() },
		});
		return apiKey;
	},

	listForUser(userId: number) {
		return prisma.apiKey.findMany({
			where: { userId },
			orderBy: { createdAt: "desc" },
		});
	},

	revoke(id: number) {
		return prisma.apiKey.delete({ where: { id } });
	},
};
