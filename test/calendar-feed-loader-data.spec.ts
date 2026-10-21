import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { loadCalendarFeed } from "@/utils/load-calendar-feed";
import { resetDatabase } from "./stories/helpers";

// loadCalendarFeed: which courses, events and exams a user's feed is built from.

test.beforeEach(resetDatabase);

const DAY = 86_400_000;
const NOW = new Date("2026-06-01T12:00:00Z");

/// A course the given user teaches that ended `daysAgo` days before `NOW`.
async function courseEnded(daysAgo: number, instructor: string) {
	const endAt = new Date(NOW.getTime() - daysAgo * DAY);
	return persistedCourseFactory.create({
		instructor,
		startAt: new Date(endAt.getTime() - 100 * DAY),
		endAt,
	});
}

test("a course that ended more than 60 days before now is left out, one that ended exactly 60 days before stays", async () => {
	const teacher = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const stale = await courseEnded(60 + 1 / 86_400, teacher.username);
	const edge = await courseEnded(60, teacher.username);
	const recent = await courseEnded(10, teacher.username);

	const { courses } = await loadCalendarFeed(teacher, NOW);

	expect(courses.map((c) => c.id).sort()).toEqual([edge.id, recent.id].sort());
	expect(courses.map((c) => c.id)).not.toContain(stale.id);
});

test("the entries of a course past the grace period are left out along with the course", async () => {
	const teacher = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const stale = await courseEnded(90, teacher.username);
	await persistedCalendarEventFactory.create({ course: stale.id });
	await persistedExamFactory.create({
		course: stale.id,
		scheduledAt: new Date(NOW.getTime() - 100 * DAY),
	});

	const { entries, courses } = await loadCalendarFeed(teacher, NOW);

	expect(entries).toEqual([]);
	expect(courses).toEqual([]);
});

test("an admin gets only the courses they teach or attend, not every course", async () => {
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const taught = await courseEnded(-30, admin.username);
	const attended = await persistedCourseFactory.create({
		startAt: new Date(NOW.getTime() - 10 * DAY),
		endAt: new Date(NOW.getTime() + 30 * DAY),
	});
	await db.enrollment.create(
		{ course: attended.id, username: admin.username },
		FULL_ACCESS,
	);
	const stranger = await persistedCourseFactory.create({
		startAt: new Date(NOW.getTime() - 10 * DAY),
		endAt: new Date(NOW.getTime() + 30 * DAY),
	});
	await persistedCalendarEventFactory.create({ course: stranger.id });

	const { entries, courses } = await loadCalendarFeed(admin, NOW);

	expect(courses.map((c) => c.id).sort()).toEqual(
		[taught.id, attended.id].sort(),
	);
	expect(entries.map((e) => e.courseId)).not.toContain(stranger.id);
});

test("a student's entries hold their course's meetings and published exams but not a draft", async () => {
	const course = await persistedCourseFactory.create(
		{
			startAt: new Date(NOW.getTime() - 10 * DAY),
			endAt: new Date(NOW.getTime() + 60 * DAY),
		},
		{ transient: { students: 1 } },
	);
	const student = course.students[0];
	if (!student) throw new Error("the course has no enrolled student");
	const meeting = await persistedCalendarEventFactory.create({
		course: course.id,
		title: "Lab 1",
	});
	const scheduledAt = new Date(NOW.getTime() + 5 * DAY);
	await persistedExamFactory.create({
		course: course.id,
		slug: "p1",
		status: "SCHEDULED",
		scheduledAt,
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "draft",
		status: "DRAFT",
		scheduledAt,
	});

	const { entries } = await loadCalendarFeed(student, NOW);

	const meetings = entries.flatMap((e) =>
		e.kind === "event" ? [e.event.id] : [],
	);
	const exams = entries.flatMap((e) =>
		e.kind === "exam" ? [e.exam.slug] : [],
	);
	expect(meetings).toEqual([meeting.id]);
	expect(exams).toEqual(["p1"]);
});

test("the courses cover the course of every entry, and drafts are left out even for the instructor", async () => {
	const teacher = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const first = await courseEnded(-30, teacher.username);
	const second = await courseEnded(-40, teacher.username);
	await persistedCalendarEventFactory.create({ course: first.id });
	await persistedExamFactory.create({
		course: second.id,
		slug: "p1",
		scheduledAt: new Date(NOW.getTime() + DAY),
	});
	await persistedExamFactory.create({
		course: second.id,
		slug: "draft",
		status: "DRAFT",
		scheduledAt: new Date(NOW.getTime() + DAY),
	});

	const { entries, courses } = await loadCalendarFeed(teacher, NOW);

	expect(entries).toHaveLength(2);
	const ids = new Set(courses.map((c) => c.id));
	for (const entry of entries) expect(ids.has(entry.courseId)).toBe(true);
	expect(
		entries.flatMap((e) => (e.kind === "exam" ? [e.exam.slug] : [])),
	).toEqual(["p1"]);
});
