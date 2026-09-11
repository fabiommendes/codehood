import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type Invite,
	type InviteCreate,
	inviteService,
} from "@/db/services/invite.service";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

function buildInvite(params: Partial<InviteCreate>): InviteCreate {
	return {
		kind: "PERSONAL",
		invitedRole: "STUDENT",
		email: null,
		courseId: null,
		maxUses: null,
		createdBy: params.createdBy ?? {
			username: faker.internet.username().toLowerCase(),
			name: faker.person.fullName(),
		},
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
 * `createdBy` is provisioned automatically (a fresh user) when left unset.
 */
export const persistedInviteFactory = Factory.define<
	InviteCreate,
	PersistParams,
	Invite,
	Partial<InviteCreate>
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const createdBy =
			params.createdBy ??
			(await persistedUserFactory.create({}, { transient: transientParams }));

		return inviteService.create(
			{
				...input,
				createdBy: { username: createdBy.username, name: createdBy.name },
			},
			opts,
		);
	});

	return buildInvite(params);
});
