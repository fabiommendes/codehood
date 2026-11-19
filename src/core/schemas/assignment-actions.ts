import { publicId, slug, username } from "./base";
import { courseParams } from "./course";
import { teamCreate, teamJoin, teamName } from "./team";

/// The page of an assignment: the course in the URL and the assignment's slug.
const assignmentParams = courseParams.extend({ slug: slug });

/// A team of that assignment, by its public id.
const ofTeam = assignmentParams.extend({ team: publicId });

/// A student makes a team, or their repository on an individual assignment.
export const assignmentTeamCreate = assignmentParams.extend(teamCreate.shape);

/// A student joins a team with its code.
export const assignmentTeamJoin = assignmentParams.extend(teamJoin.shape);

/// A student leaves their team.
export const assignmentTeamLeave = ofTeam;

/// A student replaces the token of their own clone URL.
export const assignmentTeamRotate = ofTeam;

/// A student makes a temporary clone URL of their own, replacing the one before.
export const assignmentTeamTempCreate = ofTeam;

/// A student turns their temporary clone URL off.
export const assignmentTeamTempRevoke = ofTeam;

/// The instructor creates an empty team.
export const assignmentStaffCreate = assignmentParams.extend({
	name: teamName,
});

/// The instructor puts a student in a team, taking them out of another.
export const assignmentStaffAdd = ofTeam.extend({ username: username });

/// The instructor takes a student out of a team.
export const assignmentStaffRemove = ofTeam.extend({ username: username });

/// The instructor renames a team.
export const assignmentStaffRename = ofTeam.extend({ name: teamName });

/// The instructor deletes a team and its repository.
export const assignmentStaffDelete = ofTeam;
