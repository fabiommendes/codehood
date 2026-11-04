import type { z } from "zod";
import { hasPerm } from "@/auth/permissions";
import { generateToken, hashToken } from "@/auth/token";
import { NotAllowed, NotFound } from "@/core/error";
import {
	type ApiKeyId,
	apiKeyCreate,
	apiKeyFilter,
	apiKeyPK,
	apiKeySchema,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";

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

/// The CRUD shape of the API key service. `update` and `upsert` are off: a
/// key is immutable after creation, and `create` mints a secret, so re-minting
/// one on every sync would be wrong.
type ApiKeyT = {
	entity: ApiKey;
	pkFilter: ApiKeyPK;
	create: ApiKeyCreate;
	filter: ApiKeyFilter;
	update: never;
	upsert: false;
};

const defineApiKeyService = defineService<ApiKeyT>()(() => {
	/**
	 * Creates a new API key owned by `input.createdBy` and returns its raw token.
	 *
	 * The token is shown only once here; only its hash is persisted.
	 */
	const create = op({
		args: [apiKeyCreate],
		returns: apiKeySchema,
		run: async (
			tx: PrismaTx,
			input: ApiKeyCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<ApiKey> => {
			if (!hasPerm(opts.actor, "api-key.manage", input.createdBy.username)) {
				throw new NotAllowed("api-key.create");
			}
			const token = generateToken();
			const apiKey = await tx.apiKey.create({
				data: {
					publicId: generateToken(9),
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
		},
	});

	/** Finds a single API key by id or by its `publicId`. */
	const findOne = op({
		transaction: false,
		args: [apiKeyPK],
		returns: apiKeySchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: ApiKeyPK,
			opts: ServiceOptsWithoutTx,
		): Promise<ApiKey | null> => {
			const apiKey = await tx.apiKey.findUnique({
				where: apiKeyWhere(filter),
				include: apiKeyInclude,
			});
			if (!apiKey) return null;
			if (!hasPerm(opts.actor, "api-key.manage", apiKey.createdById)) {
				throw new NotAllowed("api-key.read");
			}
			return toApiKey(apiKey);
		},
	});

	/**
	 * Finds all API keys belonging to `filter.createdBy`.
	 *
	 * Filtered, not thrown: an owner whose keys `actor` may not see just gets
	 * no rows back.
	 */
	const findMany = op({
		transaction: false,
		args: [apiKeyFilter],
		returns: apiKeySchema.array(),
		run: async (
			tx: PrismaTx,
			filter: ApiKeyFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<ApiKey[]> => {
			if (!hasPerm(opts.actor, "api-key.manage", filter.createdBy)) return [];
			const apiKeys = await tx.apiKey.findMany({
				where: { createdById: filter.createdBy },
				include: apiKeyInclude,
				orderBy: { createdAt: "desc" },
			});
			return apiKeys.map(toApiKey);
		},
	});

	/** Revokes an API key. */
	const remove = op({
		run: async (
			tx: PrismaTx,
			filter: ApiKeyPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const apiKey = await tx.apiKey.findUnique({ where: apiKeyWhere(filter) });
			if (!apiKey) throw new NotFound("api-key");
			if (!hasPerm(opts.actor, "api-key.manage", apiKey.createdById)) {
				throw new NotAllowed("api-key.delete");
			}
			await tx.apiKey.delete({ where: { id: apiKey.id } });
		},
	});

	return { create, findOne, findMany, delete: remove };
});

/**
 * Looks up the API key matching `token` and stamps its `lastUsedAt`.
 *
 * Takes no actor and is not an operation of the service: the raw token is the
 * credential, and validating one is how the caller's identity gets
 * established in the first place (ADR 0005).
 */
export async function validateApiKey(
	client: PrismaClient,
	token: string,
	opts: { tx?: PrismaTx } = {},
) {
	const db = opts.tx ?? client;
	const keyHash = hashToken(token);
	const apiKey = await db.apiKey.findUnique({
		where: { keyHash },
		include: { createdBy: true },
	});
	if (!apiKey) return null;

	await db.apiKey.update({
		where: { id: apiKey.id },
		data: { lastUsedAt: new Date() },
	});

	return apiKey;
}

/**
 * The API key service of `client` (the shared client by default).
 *
 * Besides the operations it carries `validate`, bound to the same client; see
 * {@link validateApiKey}.
 */
export function makeApiKeyService(client: PrismaClient = prisma) {
	return {
		...defineApiKeyService(client),
		validate: (token: string, opts?: { tx?: PrismaTx }) =>
			validateApiKey(client, token, opts),
	};
}

/** The API key service, as built by {@link makeApiKeyService}. */
export type ApiKeyService = ReturnType<typeof makeApiKeyService>;

//
// Auxiliary functions
//

/// The `where` matching whichever of the primary keys `filter` carries.
function apiKeyWhere(filter: ApiKeyPK): Prisma.ApiKeyWhereUniqueInput {
	return "id" in filter ? { id: filter.id } : { publicId: filter.publicId };
}

// Convert a database API key record to the public-facing API key type.
function toApiKey(dbApiKey: DbApiKey): ApiKey {
	return {
		id: dbApiKey.id as ApiKeyId,
		publicId: dbApiKey.publicId,
		keyHash: dbApiKey.keyHash,
		name: dbApiKey.name,
		kind: dbApiKey.kind,
		createdBy: dbApiKey.createdBy,
		lastUsedAt: dbApiKey.lastUsedAt,
		createdAt: dbApiKey.createdAt,
	};
}
