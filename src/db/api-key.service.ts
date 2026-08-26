import { generateToken, hashToken } from "@/auth/token";
import type {
	Create,
	FindMany,
	FindOne,
	ServiceMethodOpts,
} from "./base-service";
import type { ApiKey, ApiKeyKind, PrismaClient } from "./client";
import { prisma } from "./client";

export interface CreateApiKey {
	userId: number;
	name: string;
	kind: ApiKeyKind;
}

export interface CreateApiKeyResult {
	token: string;
	apiKey: ApiKey;
}

export interface FindApiKeyBy {
	id: number;
}

export interface FindApiKeysBy {
	userId: number;
}

class ApiKeyService
	implements
		Create<CreateApiKey, CreateApiKeyResult>,
		FindOne<FindApiKeyBy, ApiKey>,
		FindMany<FindApiKeysBy, ApiKey>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	async create(
		input: CreateApiKey,
		opts?: ServiceMethodOpts,
	): Promise<CreateApiKeyResult> {
		const client = opts?.tx ?? this.prisma;
		const token = generateToken();
		const apiKey = await client.apiKey.create({
			data: {
				keyHash: hashToken(token),
				name: input.name,
				kind: input.kind,
				userId: input.userId,
			},
		});
		return { token, apiKey };
	}

	findOne(
		filter: FindApiKeyBy,
		opts?: ServiceMethodOpts,
	): Promise<ApiKey | null> {
		const client = opts?.tx ?? this.prisma;
		return client.apiKey.findUnique({ where: { id: filter.id } });
	}

	findMany(filter: FindApiKeysBy, opts?: ServiceMethodOpts): Promise<ApiKey[]> {
		const client = opts?.tx ?? this.prisma;
		return client.apiKey.findMany({
			where: { userId: filter.userId },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Looks up the key for `token` and stamps `lastUsedAt`.
	 */
	async validate(token: string, opts?: ServiceMethodOpts) {
		const client = opts?.tx ?? this.prisma;
		const keyHash = hashToken(token);
		const apiKey = await client.apiKey.findUnique({
			where: { keyHash },
			include: { user: true },
		});
		if (!apiKey) return null;
		await client.apiKey.update({
			where: { id: apiKey.id },
			data: { lastUsedAt: new Date() },
		});
		return apiKey;
	}

	revoke(id: number, opts?: ServiceMethodOpts) {
		const client = opts?.tx ?? this.prisma;
		return client.apiKey.delete({ where: { id } });
	}
}

export const apiKeyService = new ApiKeyService();
