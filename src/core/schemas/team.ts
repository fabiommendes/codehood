import { z } from "zod";
import { assignmentId, instant, publicId, teamId, username } from "./base";

/// A team's name, unique in its assignment.
export const teamName = z.string().trim().min(1).max(60).openapi({
	example: "Alpha",
});

export const teamPK = z.union([
	z.object({ id: teamId }),
	z.object({ publicId: publicId }),
]);

/// What a student sends to make a team. An individual assignment ignores the name.
export const teamCreate = z.object({ name: teamName });

/// What the instructor sends to make a team: its name and the students in it.
export const teamCreateFor = z.object({
	name: teamName,
	members: z.array(username).max(50),
});

/// The code a student types to join a team. Letter case does not matter.
export const teamJoin = z.object({
	joinCode: z.string().trim().min(1).max(32),
});

export const teamMemberSchema = z.object({
	username: z.string(),
	name: z.string(),
	joinedAt: z.date(),
});

export const teamPushSchema = z.object({
	id: z.number().int(),
	teamId: teamId,
	/// Null once the user is deleted, and on a reconciled push.
	username: z.string().nullable(),
	oldSha: z.string().nullable(),
	newSha: z.string(),
	createdAt: z.date(),
});

/// The pushes that count for a team: the last one on time and the last one after.
export const teamDeliverySchema = z.object({
	onTime: teamPushSchema.nullable(),
	late: teamPushSchema.nullable(),
});

/// How a team's size is outside the range its assignment asks for.
export const teamSizeException = z.enum(["above", "below", "empty"]);
export type TeamSizeException = z.infer<typeof teamSizeException>;

/// A team as the instructor sees it: no secrets.
export const teamSchema = z.object({
	id: teamId,
	publicId: z.string(),
	assignmentId: assignmentId,
	name: z.string(),
	/// The team's deadline: its own extension, or the assignment's.
	dueAt: z.date(),
	/// Whether `dueAt` is an extension given to this team.
	extended: z.boolean(),
	/// The commit the repository was created with; null when it started empty.
	baseSha: z.string().nullable(),
	members: z.array(teamMemberSchema),
	createdAt: z.date(),
});

/// One team in the instructor's listing.
export const teamListedSchema = teamSchema.extend({
	delivery: teamDeliverySchema,
	sizeException: teamSizeException.nullable(),
});

/// A team as one of its members sees it: with the join code (until teams
/// lock) and the reader's own token, nobody else's.
export const teamMineSchema = teamSchema.extend({
	joinCode: z.string().nullable(),
	token: z.string(),
	cloneUrl: z.url(),
	/// Newest first.
	pushes: z.array(teamPushSchema),
	delivery: teamDeliverySchema,
});

export const teamSummarySchema = z.object({
	teams: z.number().int(),
	studentsWithoutTeam: z.number().int(),
	onTime: z.number().int(),
	lateOnly: z.number().int(),
});

/// What `recordPush` takes: the push as the git route saw it.
export const teamPushInput = z.object({
	username: z.string().nullable(),
	oldSha: z.string().nullable(),
	newSha: z.string().regex(/^[0-9a-f]{40}$/),
});

export const teamMissingFiles = z.array(z.string());

/// What the instructor changes in a team: its name, its own deadline (`null` clears it), or both.
export const teamPatch = z
	.object({ name: teamName.optional(), dueAt: instant.nullable().optional() })
	.refine((input) => input.name !== undefined || input.dueAt !== undefined, {
		message: "Send a name, a dueAt or both.",
	});
