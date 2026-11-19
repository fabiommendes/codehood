import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import {
	assignmentStaffAdd,
	assignmentStaffCreate,
	assignmentStaffDelete,
	assignmentStaffRemove,
	assignmentStaffRename,
	assignmentTeamCreate,
	assignmentTeamJoin,
	assignmentTeamLeave,
	assignmentTeamRotate,
	assignmentTeamTempCreate,
	assignmentTeamTempRevoke,
} from "@/core/schemas/assignment-actions";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

/// The assignment of the page an action was posted from.
function assignmentOf(input: {
	discipline: string;
	course: string;
	slug: string;
}) {
	return { course: parseCourseParams(input), slug: input.slug };
}

export const assignment = {
	/** A student makes a team, or their repository on an individual assignment. */
	createTeam: defineAction({
		accept: "form",
		input: assignmentTeamCreate,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.create(
				assignmentOf(input),
				{ name: input.name },
				{ actor },
			);
		}),
	}),

	/** A student joins a team with its code. */
	joinTeam: defineAction({
		accept: "form",
		input: assignmentTeamJoin,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.join(
				assignmentOf(input),
				{ joinCode: input.joinCode },
				{ actor },
			);
		}),
	}),

	/** A student leaves their team. */
	leaveTeam: defineAction({
		accept: "form",
		input: assignmentTeamLeave,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.leave({ publicId: input.team }, { actor });
		}),
	}),

	/** A student replaces the token of their own clone URL. */
	rotateToken: defineAction({
		accept: "form",
		input: assignmentTeamRotate,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.rotateToken({ publicId: input.team }, { actor });
		}),
	}),

	/** A student makes a temporary clone URL of their own, replacing the one before. */
	createTempToken: defineAction({
		accept: "form",
		input: assignmentTeamTempCreate,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.createTempToken({ publicId: input.team }, { actor });
		}),
	}),

	/** A student turns their temporary clone URL off. */
	revokeTempToken: defineAction({
		accept: "form",
		input: assignmentTeamTempRevoke,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.revokeTempToken({ publicId: input.team }, { actor });
		}),
	}),

	/** The instructor creates an empty team. */
	staffCreateTeam: defineAction({
		input: assignmentStaffCreate,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.createFor(
				assignmentOf(input),
				{ name: input.name, members: [] },
				{ actor },
			);
		}),
	}),

	/** The instructor puts a student in a team, taking them out of another. */
	staffAddMember: defineAction({
		input: assignmentStaffAdd,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.addMember({ publicId: input.team }, input.username, {
				actor,
			});
		}),
	}),

	/** The instructor takes a student out of a team. */
	staffRemoveMember: defineAction({
		input: assignmentStaffRemove,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.removeMember({ publicId: input.team }, input.username, {
				actor,
			});
		}),
	}),

	/** The instructor renames a team. */
	staffRenameTeam: defineAction({
		input: assignmentStaffRename,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.rename({ publicId: input.team }, input.name, { actor });
		}),
	}),

	/** The instructor deletes a team and its repository. */
	staffDeleteTeam: defineAction({
		input: assignmentStaffDelete,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.team.remove({ publicId: input.team }, { actor });
		}),
	}),
};
