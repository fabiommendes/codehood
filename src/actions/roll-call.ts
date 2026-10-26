import { defineAction } from "astro:actions";
import type { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import {
	rollCallAttendances,
	rollCallOpen,
	rollCallTarget,
} from "@/core/schemas";
import { db } from "@/db";
import type { RollCall, RollCallPK } from "@/db/services/roll-call.service";
import { m } from "@/i18n";
import { checkInQrSvg } from "@/services/roll-call-qr";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

/// The target of every roll call action.
type Target = z.infer<typeof rollCallTarget>;

/// The service key of the roll call `input` points at.
function pkOf(input: Target): RollCallPK {
	return {
		course: parseCourseParams({
			discipline: input.discipline,
			course: input.course,
		}),
		week: input.week,
		timeSlot: input.timeSlot,
	};
}

/// What the management page needs to redraw itself.
function snapshot(rollCall: RollCall) {
	return {
		closesAt: rollCall.closesAt,
		actsAsInvite: rollCall.actsAsInvite,
		attendances: rollCall.attendances,
	};
}

/// Instructor actions on a roll call: open, close, project and correct it.
export const rollCall = {
	/** Opens the roll call of a meeting, creating it on first use and reopening it afterwards. */
	open: defineAction({
		input: rollCallOpen,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const pk = pkOf(input);
			const existing = await db.rollCall.findOne(pk, { actor });
			const opened = existing
				? await db.rollCall.open(pk, { actor })
				: await db.rollCall.create(
						{
							event: pk,
							actsAsInvite: input.actsAsInvite ?? false,
						},
						{ actor },
					);
			return snapshot(opened);
		}),
	}),

	/** Closes the roll call now. */
	close: defineAction({
		input: rollCallTarget,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return snapshot(await db.rollCall.close(pkOf(input), { actor }));
		}),
	}),

	/** Deletes the roll call and its attendances. */
	delete: defineAction({
		input: rollCallTarget,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.rollCall.delete(pkOf(input), { actor });
		}),
	}),

	/** Reads the roll call's current state, for the management page to poll. */
	get: defineAction({
		input: rollCallTarget,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const found = await db.rollCall.findOne(pkOf(input), { actor });
			if (!found) {
				throw new Error(m.errors_meeting_no_roll_call());
			}
			return snapshot(found);
		}),
	}),

	/**
	 * Merges attendances into the roll call: an object marks a student present
	 * (or changes the note), `null` removes the student.
	 */
	update: defineAction({
		input: rollCallAttendances,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const updated = await db.rollCall.update(
				pkOf(input),
				{ attendances: input.attendances },
				{ actor },
			);
			return snapshot(updated);
		}),
	}),

	/**
	 * Returns the code on screen, when it changes, when the roll call closes,
	 * how many students are present and the QR code of the check-in link.
	 */
	currentCode: defineAction({
		input: rollCallTarget,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const pk = pkOf(input);
			const { code, changedAt, nextChangeAt } = await db.rollCall.currentCode(
				pk,
				{
					actor,
				},
			);
			const found = await db.rollCall.findOne(pk, { actor });
			if (!found) {
				throw new Error(m.errors_meeting_no_roll_call());
			}
			return {
				code,
				changedAt,
				nextChangeAt,
				closesAt: found.closesAt,
				present: Object.keys(found.attendances).length,
				qr: checkInQrSvg(context.url.origin, found.id, code),
			};
		}),
	}),
};
