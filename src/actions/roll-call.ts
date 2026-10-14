import { defineAction } from "astro:actions";
import { z } from "astro/zod";
import { requireUser } from "@/auth/require-user";
import { db } from "@/db";
import type { RollCall, RollCallPK } from "@/db/services/roll-call.service";
import { checkInQrSvg } from "@/services/roll-call-qr";
import { parseCourseParams } from "@/urls";
import { withServiceErrors } from "./helpers";

/// Identifies a roll call by the course's URL segments, week and time slot.
const target = z.object({
	discipline: z.string().min(1),
	course: z.string().min(1),
	week: z.number().int(),
	timeSlot: z.string().min(1),
});

type Target = z.infer<typeof target>;

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
		input: target.extend({ actsAsInvite: z.boolean().optional() }),
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
		input: target,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return snapshot(await db.rollCall.close(pkOf(input), { actor }));
		}),
	}),

	/** Deletes the roll call and its attendances. */
	delete: defineAction({
		input: target,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			await db.rollCall.delete(pkOf(input), { actor });
		}),
	}),

	/** Reads the roll call's current state, for the management page to poll. */
	get: defineAction({
		input: target,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const found = await db.rollCall.findOne(pkOf(input), { actor });
			if (!found) {
				throw new Error("This meeting has no roll call.");
			}
			return snapshot(found);
		}),
	}),

	/**
	 * Merges attendances into the roll call: an object marks a student present
	 * (or changes the note), `null` removes the student.
	 */
	update: defineAction({
		input: target.extend({
			attendances: z.record(
				z.string().min(1),
				z.object({ note: z.string().trim().max(200).nullish() }).nullable(),
			),
		}),
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
		input: target,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const pk = pkOf(input);
			const { code, nextChangeAt } = await db.rollCall.currentCode(pk, {
				actor,
			});
			const found = await db.rollCall.findOne(pk, { actor });
			if (!found) {
				throw new Error("This meeting has no roll call.");
			}
			return {
				code,
				nextChangeAt,
				closesAt: found.closesAt,
				present: Object.keys(found.attendances).length,
				qr: checkInQrSvg(context.url.origin, found.id, code),
			};
		}),
	}),
};
