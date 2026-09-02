import { expect, test } from "@playwright/test";
import { canViewCourseContents } from "@/auth/permissions";
import { FULL_ACCESS, type ServiceOpts, SYSTEM } from "@/db/base-service";
import { calendarEventService } from "@/db/calendar-event.service";
import { prisma } from "@/db/client";
import { courseService } from "@/db/course.service";
import { disciplineService } from "@/db/discipline.service";
import { editionService } from "@/db/edition.service";
import { relinkExam } from "@/db/exam-link";
import { timeSlotService } from "@/db/time-slot.service";
import { userService } from "@/db/user.service";

// Random suffix, not an incrementing counter: shared test database across
// spec files. Prefixed "cal-" so it never collides with another file's tag().
function tag(prefix: string): string {
	return `cal-${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return userService.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: "x",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function ensureEdition(slug = "2026-1"): Promise<string> {
	if (!(await editionService.findOne({ slug }))) {
		await editionService.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

async function makeCourse(instructorUsername: string) {
	const disciplineSlug = tag("disc");
	await disciplineService.create(
		{ slug: disciplineSlug, name: disciplineSlug },
		FULL_ACCESS,
	);
	const editionSlug = await ensureEdition();
	return courseService.create(
		{
			disciplineSlug,
			instructorUsername,
			editionSlug,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

async function makeSlot(
	courseId: number,
	opts: ServiceOpts = { actor: SYSTEM },
) {
	return timeSlotService.create(
		{ courseId, slug: "mon", day: "MONDAY", startMin: 840, durationMin: 120 },
		opts,
	);
}

test("create given only a day fills startAt and durationMin from the slot, and keeps explicit values when given", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const defaulted = await calendarEventService.create(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "w01",
			date: "2026-01-05", // a Monday
			week: 1,
			title: "Intro",
			contentHash: tag("h"),
		},
		opts,
	);
	expect(defaulted.durationMin).toBe(slot.durationMin);
	// 2026-01-05 at slot.startMin (840 = 14:00) in the server zone.
	expect(defaulted.startAt.getTime()).toBeGreaterThan(
		new Date("2026-01-05T00:00:00Z").getTime(),
	);

	const explicit = await calendarEventService.create(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "w03",
			date: "2026-01-19",
			startMin: 900,
			durationMin: 45,
			week: 3,
			title: "Midterm",
			kind: "EXAM",
			contentHash: tag("h"),
		},
		opts,
	);
	expect(explicit.durationMin).toBe(45);
	expect(explicit.timeSlot.id).toBe(slot.id);
});

test("create rejects a slot belonging to another course, and an event whose startAt falls on a different weekday than its slot", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slotA = await makeSlot(courseA.id, opts);

	await expect(
		calendarEventService.create(
			{
				courseId: courseB.id,
				timeSlotId: slotA.id,
				slug: "w01",
				date: "2026-01-05",
				week: 1,
				title: "Intro",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	// 2026-01-06 is a Tuesday; slotA is MONDAY.
	await expect(
		calendarEventService.create(
			{
				courseId: courseA.id,
				timeSlotId: slotA.id,
				slug: "w01",
				date: "2026-01-06",
				week: 1,
				title: "Intro",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a second event on the same slot on the same local day", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	await calendarEventService.create(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "w01",
			date: "2026-01-05",
			week: 1,
			title: "Intro",
			contentHash: tag("h"),
		},
		opts,
	);

	await expect(
		calendarEventService.create(
			{
				courseId: course.id,
				timeSlotId: slot.id,
				slug: "w01-again",
				date: "2026-01-05",
				startMin: 900, // still the same local day
				week: 1,
				title: "Intro, again",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a missing contentHash; update stores the supplied one verbatim", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	await expect(
		calendarEventService.create(
			{
				courseId: course.id,
				timeSlotId: slot.id,
				slug: "w01",
				date: "2026-01-05",
				week: 1,
				title: "Intro",
				contentHash: "",
			},
			opts,
		),
	).rejects.toThrow();

	const event = await calendarEventService.create(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "w01",
			date: "2026-01-05",
			week: 1,
			title: "Intro",
			contentHash: tag("h"),
		},
		opts,
	);

	const newHash = tag("verbatim");
	const updated = await calendarEventService.update(
		{ id: event.id },
		{ contentHash: newHash },
		opts,
	);
	expect(updated.contentHash).toBe(newHash);
});

test("delete removes the row; a subsequent findOne returns null (no archive)", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const event = await calendarEventService.create(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "w01",
			date: "2026-01-05",
			week: 1,
			title: "Intro",
			contentHash: tag("h"),
		},
		opts,
	);
	await calendarEventService.delete({ id: event.id }, opts);
	await expect(
		calendarEventService.findOne({ id: event.id }, opts),
	).resolves.toBeNull();
});

test("findMany: window overlap on `from`, exclusivity on `to`, kind/week filters, and ordering by startAt across courses", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slotA = await makeSlot(courseA.id, opts);
	const slotB = await timeSlotService.create(
		{
			courseId: courseB.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 600,
			durationMin: 60,
		},
		opts,
	);

	// Runs 14:00-16:00 on 2026-01-05: still running at a `from` of 15:00.
	const stillRunning = await calendarEventService.create(
		{
			courseId: courseA.id,
			timeSlotId: slotA.id,
			slug: "still-running",
			date: "2026-01-05",
			week: 1,
			kind: "LECTURE",
			title: "Still running at from",
			contentHash: tag("h"),
		},
		opts,
	);
	// Strictly inside [from, to): the ordering/kind-filter fixture.
	const inBetween = await calendarEventService.create(
		{
			courseId: courseA.id,
			timeSlotId: slotA.id,
			slug: "in-between",
			date: "2026-01-12",
			week: 3,
			kind: "LECTURE",
			title: "In between",
			contentHash: tag("h"),
		},
		opts,
	);
	// Starts exactly at `to`: excluded.
	const startsAtTo = await calendarEventService.create(
		{
			courseId: courseB.id,
			timeSlotId: slotB.id,
			slug: "starts-at-to",
			date: "2026-01-19",
			startMin: 600,
			week: 2,
			kind: "LAB",
			title: "Starts exactly at to",
			contentHash: tag("h"),
		},
		opts,
	);

	const from = new Date("2026-01-05T18:00:00Z"); // 15:00 America/Sao_Paulo, inside stillRunning's window
	const to = startsAtTo.startAt;

	const results = await calendarEventService.findMany(
		{ courseIds: [courseA.id, courseB.id], from, to },
		opts,
	);
	expect(results.map((r) => r.id)).toEqual([stillRunning.id, inBetween.id]);

	const kindFiltered = await calendarEventService.findMany(
		{ courseIds: [courseA.id, courseB.id], kinds: ["LECTURE"] },
		opts,
	);
	expect(kindFiltered.every((e) => e.kind === "LECTURE")).toBe(true);
	expect(kindFiltered.map((e) => e.id).sort()).toEqual(
		[stillRunning.id, inBetween.id].sort(),
	);

	const weekFiltered = await calendarEventService.findMany(
		{ courseIds: [courseA.id, courseB.id], weeks: [3] },
		opts,
	);
	expect(weekFiltered.map((e) => e.id)).toEqual([inBetween.id]);
});

test("a student enrolled in one of two courses sees only that course's events; a dropped student sees none; the instructor sees their own", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const active = await makeUser("STUDENT");
	const dropped = await makeUser("STUDENT");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slotA = await makeSlot(courseA.id, opts);

	await courseService.enroll(
		{ courseId: courseA.id, userId: active.id },
		FULL_ACCESS,
	);
	await courseService.enroll(
		{ courseId: courseA.id, userId: dropped.id },
		FULL_ACCESS,
	);
	await courseService.unenroll(
		{ courseId: courseA.id, userId: dropped.id },
		FULL_ACCESS,
	);

	await calendarEventService.create(
		{
			courseId: courseA.id,
			timeSlotId: slotA.id,
			slug: "w01",
			date: "2026-01-05",
			week: 1,
			title: "Intro",
			contentHash: tag("h"),
		},
		opts,
	);

	await expect(
		calendarEventService.findMany(
			{ courseIds: [courseA.id, courseB.id] },
			{ actor: active },
		),
	).resolves.toHaveLength(1);
	await expect(
		calendarEventService.findMany(
			{ courseIds: [courseA.id, courseB.id] },
			{ actor: dropped },
		),
	).resolves.toHaveLength(0);
	await expect(
		calendarEventService.findMany(
			{ courseIds: [courseA.id] },
			{ actor: instructor },
		),
	).resolves.toHaveLength(1);
});

test("canViewCourseContents agreement: findMany's visibility matches the predicate over a fixture of actors", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const otherInstructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const active = await makeUser("STUDENT");
	const dropped = await makeUser("STUDENT");
	const outsider = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	await courseService.enroll(
		{ courseId: course.id, userId: active.id },
		FULL_ACCESS,
	);
	await courseService.enroll(
		{ courseId: course.id, userId: dropped.id },
		FULL_ACCESS,
	);
	await courseService.unenroll(
		{ courseId: course.id, userId: dropped.id },
		FULL_ACCESS,
	);

	await calendarEventService.create(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "w01",
			date: "2026-01-05",
			week: 1,
			title: "Intro",
			contentHash: tag("h"),
		},
		opts,
	);

	const courseShape = {
		instructor: { id: instructor.id },
		enrollments: [{ userId: active.id }],
	};
	const actors = [
		{ label: "SYSTEM", actor: SYSTEM },
		{ label: "admin", actor: admin },
		{ label: "instructor", actor: instructor },
		{ label: "otherInstructor", actor: otherInstructor },
		{ label: "active student", actor: active },
		{ label: "dropped student", actor: dropped },
		{ label: "outsider", actor: outsider },
	] as const;

	for (const { label, actor } of actors) {
		const visible = await calendarEventService.findMany(
			{ courseIds: [course.id] },
			{ actor },
		);
		const expectVisible = canViewCourseContents(actor, courseShape);
		expect(visible.length > 0, label).toBe(expectVisible);
	}
});

test("a student's event carries exam: null when the linked exam is DRAFT; the instructor's carries the exam", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);
	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);

	const event = await calendarEventService.create(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "w03-midterm",
			date: "2026-01-19", // Monday, 14:00-16:00
			week: 3,
			kind: "EXAM",
			title: "Midterm slot",
			contentHash: tag("h"),
		},
		opts,
	);

	const exam = await prisma.exam.create({
		data: {
			slug: tag("exam"),
			status: "DRAFT",
			courseId: course.id,
			title: "Midterm",
			authorId: instructor.id,
			scheduledAt: event.startAt,
			durationMs: 60 * 60_000,
		},
	});
	await relinkExam(prisma, exam.id);

	const asStudent = await calendarEventService.findOne(
		{ id: event.id },
		{ actor: student },
	);
	expect(asStudent?.exam).toBeNull();

	const asInstructor = await calendarEventService.findOne(
		{ id: event.id },
		{ actor: instructor },
	);
	expect(asInstructor?.exam).toMatchObject({ id: exam.id, title: "Midterm" });

	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "SCHEDULED" },
	});
	const asStudentAfterPublish = await calendarEventService.findOne(
		{ id: event.id },
		{ actor: student },
	);
	expect(asStudentAfterPublish?.exam?.id).toBe(exam.id);
});
