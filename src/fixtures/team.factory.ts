import { Factory } from "fishery";
import { db } from "@/db";
import { type PersistParams, serviceOpts } from "./support";

type TeamCreate = Parameters<typeof db.team.create>[1];
type AssignmentPK = Parameters<typeof db.team.create>[0];
type TeamMine = Awaited<ReturnType<typeof db.team.create>>;
type TeamAdmin = Awaited<ReturnType<typeof db.team.createFor>>;

export interface TeamPersistParams extends PersistParams {
	/// The assignment the team belongs to. Required.
	assignment?: AssignmentPK;
	/// Usernames put in the team by `createFor`, as the instructor.
	members?: string[];
}

function buildTeam(sequence: number, params: Partial<TeamCreate>): TeamCreate {
	return { name: params.name ?? `team-${sequence}` };
}

/** Builds `TeamService.create` payloads. */
export const teamFactory = Factory.define<
	TeamCreate,
	unknown,
	TeamCreate,
	Partial<TeamCreate>
>(({ sequence, params }) => buildTeam(sequence, params));

/**
 * Builds a team payload and persists it through `teamService.create`, as the
 * student in `transient.actor`, who becomes its first member.
 *
 * `transient.assignment` is required.
 */
export const persistedTeamFactory = Factory.define<
	TeamCreate,
	TeamPersistParams,
	TeamMine,
	Partial<TeamCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate((input) => {
		if (!transientParams.assignment) {
			throw new Error("persistedTeamFactory needs transient.assignment");
		}
		return db.team.create(
			transientParams.assignment,
			input,
			serviceOpts(transientParams),
		);
	});

	return buildTeam(sequence, params);
});

/**
 * Builds a team payload and persists it through `teamService.createFor`, as
 * the instructor in `transient.actor`, with the students in `transient.members`.
 *
 * `transient.assignment` is required.
 */
export const persistedStaffTeamFactory = Factory.define<
	TeamCreate,
	TeamPersistParams,
	TeamAdmin,
	Partial<TeamCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate((input) => {
		if (!transientParams.assignment) {
			throw new Error("persistedStaffTeamFactory needs transient.assignment");
		}
		return db.team.createFor(
			transientParams.assignment,
			{ ...input, members: transientParams.members ?? [] },
			serviceOpts(transientParams),
		);
	});

	return buildTeam(sequence, params);
});
