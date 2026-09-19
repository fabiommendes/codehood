import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type CalendarEvent,
	type CalendarEventCreate,
	db,
	type schema,
} from "@/db";
import type { Weekday } from "@/db/client";
import { type PersistParams, serviceOpts } from "./support";
import { persistedTimeSlotFactory } from "./time-slot.factory";

const WEEKDAYS: readonly Weekday[] = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
];

/**
 * `YYYY-MM-DD` for the next calendar date landing on `day`, starting from
 * `from`. A calendar date's weekday is timezone-independent, so this needs
 * no server-timezone awareness — unlike `startAt`, which the service derives
 * from this date plus `startMin`.
 */
function isoDateForWeekday(day: Weekday, from: Date = new Date()): string {
	const target = WEEKDAYS.indexOf(day);
	const base = new Date(
		Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
	);
	base.setUTCDate(base.getUTCDate() + ((target - base.getUTCDay() + 7) % 7));
	return base.toISOString().slice(0, 10);
}

function buildCalendarEvent(
	sequence: number,
	params: Partial<CalendarEventCreate>,
): CalendarEventCreate {
	return {
		courseId: params.courseId ?? (0 as schema.CourseId),
		timeSlotId: params.timeSlotId ?? (0 as schema.TimeSlotId),
		slug: params.slug ?? `event-${sequence}`,
		date: params.date ?? isoDateForWeekday("MONDAY"),
		week: params.week ?? 1,
		kind: "LECTURE",
		title: faker.lorem.words(3),
		description: faker.lorem.sentence(),
		contentHash: faker.string.hexadecimal({ length: 40 }).slice(2),
	};
}

/** Builds `CalendarEventCreate` payloads, ready for `calendarEventService.create`. */
export const calendarEventFactory = Factory.define<
	CalendarEventCreate,
	unknown,
	CalendarEventCreate,
	Partial<CalendarEventCreate>
>(({ sequence, params }) => buildCalendarEvent(sequence, params));

/**
 * Builds a `CalendarEventCreate` payload and persists it via
 * `calendarEventService.create`.
 *
 * `courseId`/`timeSlotId` are provisioned automatically (a fresh course and
 * a time slot in it) when left unset, and `date` is computed to match the
 * provisioned slot's weekday. Overriding `timeSlotId` without also
 * overriding `date` is on the caller — the service rejects a mismatch.
 */
export const persistedCalendarEventFactory = Factory.define<
	CalendarEventCreate,
	PersistParams,
	CalendarEvent,
	Partial<CalendarEventCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);

		let courseId = params.courseId;
		let timeSlotId = params.timeSlotId;
		let date = params.date;

		if (timeSlotId === undefined || courseId === undefined) {
			const slot = await persistedTimeSlotFactory.create(
				courseId ? { courseId } : {},
				{ transient: transientParams },
			);
			courseId = slot.courseId;
			timeSlotId = slot.id;
			date ??= isoDateForWeekday(slot.day);
		}

		return db.calendarEvent.create(
			{ ...input, courseId, timeSlotId, date: date ?? input.date },
			opts,
		);
	});

	return buildCalendarEvent(sequence, params);
});
