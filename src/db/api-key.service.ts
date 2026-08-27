import { canManageApiKeys } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import {
	type ActingOpts,
	type CreateAs,
	type FindManyAs,
	type FindOneAs,
	ForbiddenError,
	type ServiceMethodOpts,
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
		CreateAs<CreateApiKey, CreateApiKeyResult>,
		FindOneAs<FindApiKeyBy, ApiKey>,
		FindManyAs<FindApiKeysBy, ApiKey>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	async create(
		input: CreateApiKey,
		opts: ActingOpts,
	): Promise<CreateApiKeyResult> {
		if (!canManageApiKeys(opts.actor, input.userId)) {
			throw new ForbiddenError();
		}
		const client = opts.tx ?? this.prisma;
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

	async findOne(
		filter: FindApiKeyBy,
		opts: ActingOpts,
	): Promise<ApiKey | null> {
		const client = opts.tx ?? this.prisma;
		const apiKey = await client.apiKey.findUnique({
			where: { id: filter.id },
		});
		if (!apiKey) return null;
		if (!canManageApiKeys(opts.actor, apiKey.userId)) {
			throw new ForbiddenError();
		}
		return apiKey;
	}

	/** Filtered, not thrown: a userId whose keys `actor` may not see just gets no rows back. */
	findMany(filter: FindApiKeysBy, opts: ActingOpts): Promise<ApiKey[]> {
		if (!canManageApiKeys(opts.actor, filter.userId)) {
			return Promise.resolve([]);
		}
		const client = opts.tx ?? this.prisma;
		return client.apiKey.findMany({
			where: { userId: filter.userId },
			orderBy: { createdAt: "desc" },
		});
	}

	/**
	 * Looks up the key for `token` and stamps `lastUsedAt`. Not actor-gated:
	 * the raw token is the credential, and validating one is how the caller's
	 * identity gets established in the first place.
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

	/**
	 * Revokes an API key. There is no silent no-op: a missing key and a key
	 * `actor` may not manage both throw `FORBIDDEN`, so a caller can't probe
	 * for another user's key ids by comparing error codes.
	 */
	async revoke(id: number, opts: ActingOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const apiKey = await client.apiKey.findUnique({ where: { id } });
		if (!apiKey || !canManageApiKeys(opts.actor, apiKey.userId)) {
			throw new ForbiddenError();
		}
		await client.apiKey.delete({ where: { id } });
	}
}

export const apiKeyService = new ApiKeyService();
