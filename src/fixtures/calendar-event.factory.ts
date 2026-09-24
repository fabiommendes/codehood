import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type CalendarEvent,
	type CalendarEventCreate,
	db,
	type schema,
} from "@/db";
import { type PersistParams, serviceOpts } from "./support";
import { persistedTimeSlotFactory } from "./time-slot.factory";

function buildCalendarEvent(
	params: Partial<CalendarEventCreate>,
): CalendarEventCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		timeSlot: params.timeSlot ?? (0 as schema.TimeSlotId),
		week: params.week ?? 1,
		kind: "REGULAR",
		title: faker.lorem.words(3),
		description: faker.lorem.sentence(),
		ref: faker.string.hexadecimal({ length: 40 }).slice(2),
	};
}

/** Builds `CalendarEventCreate` payloads, ready for `calendarEventService.create`. */
export const calendarEventFactory = Factory.define<
	CalendarEventCreate,
	unknown,
	CalendarEventCreate,
	Partial<CalendarEventCreate>
>(({ params }) => buildCalendarEvent(params));

/**
 * Builds a `CalendarEventCreate` payload and persists it via
 * `calendarEventService.create`.
 *
 * `course`/`timeSlot` are provisioned automatically (a fresh course and a
 * time slot in it) when left unset.
 */
export const persistedCalendarEventFactory = Factory.define<
	CalendarEventCreate,
	PersistParams,
	CalendarEvent,
	Partial<CalendarEventCreate>
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);

		let course = params.course;
		let timeSlot = params.timeSlot;

		if (timeSlot === undefined || course === undefined) {
			const slot = await persistedTimeSlotFactory.create(
				typeof course === "number" ? { course } : {},
				{ transient: transientParams },
			);
			course = slot.courseId;
			timeSlot = slot.id;
		}

		return db.calendarEvent.create({ ...input, course, timeSlot }, opts);
	});

	return buildCalendarEvent(params);
});
