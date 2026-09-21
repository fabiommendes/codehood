import { Factory } from "fishery";
import { SYSTEM } from "@/auth/actor";
import { db, type Invite, type InviteCreate } from "@/db";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

function buildInvite(params: Partial<InviteCreate>): InviteCreate {
	return {
		kind: "PERSONAL",
		invitedRole: "STUDENT",
		email: null,
		courseId: null,
		maxUses: null,
		createdBy: params.createdBy,
	};
}

/** Builds `InviteCreate` payloads, ready for `inviteService.create`. */
export const inviteFactory = Factory.define<
	InviteCreate,
	unknown,
	InviteCreate,
	Partial<InviteCreate>
>(({ params }) => buildInvite(params));

/**
 * Builds an `InviteCreate` payload and persists it via `inviteService.create`.
 *
 * `createdBy` is only honoured when the persisting actor is `SYSTEM` — the
 * service derives it from a real actor instead — and is provisioned
 * automatically (a fresh user) when left unset in that case.
 */
export const persistedInviteFactory = Factory.define<
	InviteCreate,
	PersistParams,
	Invite,
	Partial<InviteCreate>
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		if (opts.actor !== SYSTEM) {
			return db.invite.create(input, opts);
		}

		const createdBy =
			params.createdBy ??
			(await persistedUserFactory.create({}, { transient: transientParams }));

		return db.invite.create(
			{
				...input,
				createdBy: { username: createdBy.username, name: createdBy.name },
			},
			opts,
		);
	});

	return buildInvite(params);
});
