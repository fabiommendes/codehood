import type { z } from "zod";
import { canManageApiKeys } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import { NotAllowed, RuleViolation } from "@/core/error";
import {
	type ApiKeyId,
	apiKeyCreate,
	apiKeyFilter,
	apiKeyPK,
	apiKeySchema,
} from "@/core/schemas";
import type { Crud, ServiceOpts } from "@/db/base-service";
import { Validate } from "@/utils/validate";
import { type Prisma, type PrismaClient, prisma } from "../client";

const apiKeyInclude = {
	createdBy: { select: { username: true, name: true } },
} satisfies Prisma.ApiKeyInclude;

type DbApiKey = Prisma.ApiKeyGetPayload<{ include: typeof apiKeyInclude }>;

export type { ApiKeyId } from "@/core/schemas";

//
// Type definitions
//
export type ApiKeyCreate = z.infer<typeof apiKeyCreate>;
export type ApiKey = z.infer<typeof apiKeySchema>;
export type ApiKeyPK = z.infer<typeof apiKeyPK>;
export type ApiKeyFilter = z.infer<typeof apiKeyFilter>;

class ApiKeyService
	implements
		Crud<{
			entity: ApiKey;
			pkFilter: ApiKeyPK;
			create: ApiKeyCreate;
			filter: ApiKeyFilter;
			update: never;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a new API key owned by `input.createdBy` and returns its raw token.
	 *
	 * The token is shown only once here; only its hash is persisted.
	 */
	@Validate({
		service: true,
		returns: apiKeySchema,
		args: [apiKeyCreate],
	})
	async create(input: ApiKeyCreate, opts: ServiceOpts): Promise<ApiKey> {
		if (!canManageApiKeys(opts.actor, input.createdBy.username)) {
			throw new NotAllowed({ action: "create-api-key" });
		}
		const client = opts.tx ?? this.prisma;
		const token = generateToken();
		const apiKey = await client.apiKey.create({
			data: {
				keyHash: hashToken(token),
				name: input.name,
				kind: input.kind,
				createdById: input.createdBy.username,
			},
			include: apiKeyInclude,
		});
		const result = toApiKey(apiKey);
		result.token = token; // only here, never in the database
		return result;
	}

	/**
	 * Finds a single API key by id.
	 */
	@Validate({
		service: true,
		returns: apiKeySchema.nullable(),
		args: [apiKeyPK],
	})
	async findOne(filter: ApiKeyPK, opts: ServiceOpts): Promise<ApiKey | null> {
		const client = opts.tx ?? this.prisma;
		const apiKey = await client.apiKey.findUnique({
			where: { id: filter.id },
			include: apiKeyInclude,
		});
		if (!apiKey) return null;
		if (!canManageApiKeys(opts.actor, apiKey.createdById)) {
			throw new NotAllowed({ action: "read-api-key" });
		}
		return toApiKey(apiKey);
	}

	/**
	 * Finds all API keys belonging to `filter.createdById`.
	 *
	 * Filtered, not thrown: an owner whose keys `actor` may not see just gets
	 * no rows back.
	 */
	@Validate({
		service: true,
		returns: apiKeySchema.array(),
		args: [apiKeyFilter],
	})
	async findMany(filter: ApiKeyFilter, opts: ServiceOpts): Promise<ApiKey[]> {
		if (!canManageApiKeys(opts.actor, filter.createdById)) return [];
		const client = opts.tx ?? this.prisma;
		const apiKeys = await client.apiKey.findMany({
			where: { createdById: filter.createdById },
			include: apiKeyInclude,
			orderBy: { createdAt: "desc" },
		});
		return apiKeys.map(toApiKey);
	}

	/**
	 * Looks up the API key matching `token` and stamps its `lastUsedAt`.
	 *
	 * Not actor-gated: the raw token is the credential, and validating one is
	 * how the caller's identity gets established in the first place.
	 */
	async validate(token: string, opts?: ServiceOpts) {
		const client = opts?.tx ?? this.prisma;
		const keyHash = hashToken(token);
		const apiKey = await client.apiKey.findUnique({
			where: { keyHash },
			include: { createdBy: true },
		});
		if (!apiKey) return null;

		await client.apiKey.update({
			where: { id: apiKey.id },
			data: { lastUsedAt: new Date() },
		});

		return apiKey;
	}

	/**
	 * Revokes an API key.
	 */
	async delete(filter: ApiKeyPK, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const apiKey = await client.apiKey.findUnique({ where: { id: filter.id } });
		if (!apiKey || !canManageApiKeys(opts.actor, apiKey.createdById)) {
			throw new NotAllowed({ action: "delete-api-key" });
		}
		await client.apiKey.delete({ where: { id: filter.id } });
	}

	/**
	 * API keys are immutable after creation.
	 */
	update(_filter: ApiKeyPK, _data: never, _opts: ServiceOpts): Promise<ApiKey> {
		throw new RuleViolation({
			message: "Update method not implemented for API keys",
		});
	}
}

export const apiKeyService = new ApiKeyService();

//
// Auxiliary functions
//

// Convert a database API key record to the public-facing API key type.
function toApiKey(dbApiKey: DbApiKey): ApiKey {
	return {
		id: dbApiKey.id as ApiKeyId,
		keyHash: dbApiKey.keyHash,
		name: dbApiKey.name,
		kind: dbApiKey.kind,
		createdBy: dbApiKey.createdBy,
		lastUsedAt: dbApiKey.lastUsedAt,
		createdAt: dbApiKey.createdAt,
	};
}
