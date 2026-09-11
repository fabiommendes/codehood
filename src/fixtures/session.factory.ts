import { Factory } from "fishery";
import {
	type SessionCreate,
	type SessionCreateResult,
	sessionService,
} from "@/db/services/session.service";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

/** Builds `SessionCreate` payloads, ready for `sessionService.create`. */
export const sessionFactory = Factory.define<SessionCreate>(({ params }) => ({
	userId: params.userId ?? "user",
}));

/**
 * Builds a `SessionCreate` payload and persists it via `sessionService.create`.
 *
 * `userId` is provisioned automatically (a fresh user) when left unset.
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
		const userId =
			params.userId ??
			(await persistedUserFactory.create({}, { transient: transientParams }))
				.username;

		return sessionService.create({ ...input, userId }, opts);
	});

	return { userId: params.userId ?? "user" };
});
