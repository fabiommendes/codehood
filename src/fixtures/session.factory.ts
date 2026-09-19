import { Factory } from "fishery";
import { db, type SessionCreate, type SessionCreateResult } from "@/db";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

/** Builds `SessionCreate` payloads, ready for `sessionService.create`. */
export const sessionFactory = Factory.define<SessionCreate>(({ params }) => ({
	username: params.username ?? "user",
}));

/**
 * Builds a `SessionCreate` payload and persists it via `sessionService.create`.
 *
 * `username` is provisioned automatically (a fresh user) when left unset.
 * Resolves to `{ token, session }`, the plaintext token being available only
 * here, same as a real login.
 */
export const persistedSessionFactory = Factory.define<
	SessionCreate,
	PersistParams,
	SessionCreateResult
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const username =
			params.username ??
			(await persistedUserFactory.create({}, { transient: transientParams }))
				.username;

		return db.session.create({ ...input, username }, opts);
	});

	return { username: params.username ?? "user" };
});
