import { expect, test } from "@playwright/test";
import { FULL_ACCESS, type UserActor } from "@/auth/actor";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { loadScheduleNav } from "@/utils/load-schedule-nav";
import { addDays, todayIn } from "@/utils/schedule-time";
import { futureDate, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

const actorOf = (user: {
	username: string;
	name: string;
	role: UserActor["role"];
}): UserActor => ({
	username: user.username,
	name: user.name,
	role: user.role,
});

test("the schedule card lists the same weeks for the instructor and a student, with the page's context", async () => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create({
		startDate: addDays(todayIn(), -70),
		endDate: addDays(todayIn(), 70),
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	for (const week of [0, 1, 12]) {
		await persistedCalendarEventFactory.create({
			course: course.id,
			timeSlot: slot.id,
			week,
		});
	}
	const href = "/cs101/ada_2026-2";

	const asInstructor = await loadScheduleNav(
		course,
		href,
		actorOf({ ...course.instructor, role: "INSTRUCTOR" }),
		"Week 0",
	);
	const asStudent = await loadScheduleNav(course, href, actorOf(student));

	expect(asInstructor.context).toBe("Week 0");
	expect(asStudent.context).toBeUndefined();
	expect(asInstructor.sections).toEqual(asStudent.sections);
	const entries = asInstructor.sections[0]?.entries ?? [];
	// The weeks already held fold into one entry; the ones ahead stay at the first level.
	expect(entries[0]?.href).toBe(`${href}/schedule#past-weeks`);
	expect(entries[0]?.children?.map((c) => c.href)).toEqual([
		`${href}/schedule#week-0`,
		`${href}/schedule#week-1`,
	]);
	expect(entries.at(-1)?.href).toBe(`${href}/schedule#week-12`);
});
