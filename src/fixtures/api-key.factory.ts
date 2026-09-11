import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type ApiKey,
	type ApiKeyCreate,
	apiKeyService,
} from "@/db/services/api-key.service";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

function buildApiKey(params: Partial<ApiKeyCreate>): ApiKeyCreate {
	return {
		name: `${faker.hacker.adjective()} key`,
		kind: "CLI",
		createdBy: params.createdBy ?? {
			username: faker.internet.username().toLowerCase(),
			name: faker.person.fullName(),
		},
	};
}

/** Builds `ApiKeyCreate` payloads, ready for `apiKeyService.create`. */
export const apiKeyFactory = Factory.define<
	ApiKeyCreate,
	unknown,
	ApiKeyCreate,
	Partial<ApiKeyCreate>
>(({ params }) => buildApiKey(params));

/**
 * Builds an `ApiKeyCreate` payload and persists it via `apiKeyService.create`.
 *
 * `createdBy` is provisioned automatically (a fresh user) when left unset.
 */
export const persistedApiKeyFactory = Factory.define<
	ApiKeyCreate,
	PersistParams,
	ApiKey,
	Partial<ApiKeyCreate>
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const createdBy =
			params.createdBy ??
			(await persistedUserFactory.create({}, { transient: transientParams }));

		return apiKeyService.create(
			{
				...input,
				createdBy: { username: createdBy.username, name: createdBy.name },
			},
			opts,
		);
	});

	return buildApiKey(params);
});
