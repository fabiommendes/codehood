import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { db, type schema, type TimeSlot, type TimeSlotCreate } from "@/db";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

const WEEKDAYS = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
] as const;

function buildTimeSlot(
	sequence: number,
	params: Partial<TimeSlotCreate>,
): TimeSlotCreate {
	return {
		courseId: params.courseId ?? (0 as schema.CourseId),
		slug: params.slug ?? `slot-${sequence}`,
		title: faker.lorem.words(2),
		day: faker.helpers.arrayElement(WEEKDAYS),
		startMin: 8 * 60,
		durationMin: 60,
	};
}

/** Builds `TimeSlotCreate` payloads, ready for `timeSlotService.create`. */
export const timeSlotFactory = Factory.define<
	TimeSlotCreate,
	unknown,
	TimeSlotCreate,
	Partial<TimeSlotCreate>
>(({ sequence, params }) => buildTimeSlot(sequence, params));

/**
 * Builds a `TimeSlotCreate` payload and persists it via `timeSlotService.create`.
 *
 * `courseId` is provisioned automatically (a fresh course) when left unset.
 */
export const persistedTimeSlotFactory = Factory.define<
	TimeSlotCreate,
	PersistParams,
	TimeSlot,
	Partial<TimeSlotCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const courseId =
			params.courseId ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		return db.timeSlot.create({ ...input, courseId }, opts);
	});

	return buildTimeSlot(sequence, params);
});
