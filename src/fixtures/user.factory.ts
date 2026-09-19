import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { db, type User, type UserCreate } from "@/db";
import { type PersistParams, serviceOpts } from "./support";

/**
 * A username matching `USERNAME_RE`: lowercase, starts alphanumeric, 2-31 chars.
 */
function fakeUsername(sequence: number): string {
	const base = faker.internet
		.username()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${base || "user"}-${sequence}`.slice(0, 31);
}

function buildUser(sequence: number, params: Partial<UserCreate>): UserCreate {
	const username = params.username ?? fakeUsername(sequence);

	return {
		username,
		name: faker.person.fullName(),
		email: faker.internet.email({ provider: "codehood.test" }).toLowerCase(),
		role: "STUDENT",
		password: faker.internet.password({ length: 12 }),
		// Required for non-admin roles; harmless when overridden to "ADMIN".
		githubId: username,
		schoolId: username,
	};
}

/** Builds `UserCreate` payloads, ready for `userService.create`. */
export const userFactory = Factory.define<UserCreate>(({ sequence, params }) =>
	buildUser(sequence, params),
);

/** Builds a `UserCreate` payload and persists it via `userService.create`. */
export const persistedUserFactory = Factory.define<
	UserCreate,
	PersistParams,
	User
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate((input) => db.user.create(input, serviceOpts(transientParams)));

	return buildUser(sequence, params);
});
