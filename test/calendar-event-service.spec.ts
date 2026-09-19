import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import type { CourseId } from "@/core/schemas";
import { db, type ServiceOpts } from "@/db";
import { prisma } from "@/db/client";
import { relinkExam } from "@/db/util.exam-link";

// Random suffix, not an incrementing counter: shared test database across
// spec files. Prefixed "cal-" so it never collides with another file's tag().
function tag(prefix: string): string {
	return `cal-${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return db.user.create(
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
	if (!(await db.edition.findOne({ slug }))) {
		await db.edition.create(
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
	await db.discipline.create(
		{ slug: disciplineSlug, name: disciplineSlug },
		FULL_ACCESS,
	);
	const editionSlug = await ensureEdition();
	return db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructorUsername,
			edition: editionSlug,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

async function makeSlot(
	courseId: CourseId,
	opts: ServiceOpts = { actor: SYSTEM },
) {
	return db.timeSlot.create(
		{ courseId, slug: "mon", day: "MONDAY", startMin: 840, durationMin: 120 },
		opts,
	);
}

test("create given only a day fills startAt and durationMin from the slot, and keeps explicit values when given", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const defaulted = await db.calendarEvent.create(
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

	const explicit = await db.calendarEvent.create(
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
		db.calendarEvent.create(
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
		db.calendarEvent.create(
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

	await db.calendarEvent.create(
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
		db.calendarEvent.create(
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
		db.calendarEvent.create(
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

	const event = await db.calendarEvent.create(
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
	const updated = await db.calendarEvent.update(
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

	const event = await db.calendarEvent.create(
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
	await db.calendarEvent.delete({ id: event.id }, opts);
	await expect(
		db.calendarEvent.findOne({ id: event.id }, opts),
	).resolves.toBeNull();
});

test("findMany: window overlap on `from`, exclusivity on `to`, kind/week filters, and ordering by startAt across courses", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slotA = await makeSlot(courseA.id, opts);
	const slotB = await db.timeSlot.create(
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
	const stillRunning = await db.calendarEvent.create(
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
	const inBetween = await db.calendarEvent.create(
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
	const startsAtTo = await db.calendarEvent.create(
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

	const results = await db.calendarEvent.findMany(
		{ courseIds: [courseA.id, courseB.id], from, to },
		opts,
	);
	expect(results.map((r) => r.id)).toEqual([stillRunning.id, inBetween.id]);

	const kindFiltered = await db.calendarEvent.findMany(
		{ courseIds: [courseA.id, courseB.id], kinds: ["LECTURE"] },
		opts,
	);
	expect(kindFiltered.every((e) => e.kind === "LECTURE")).toBe(true);
	expect(kindFiltered.map((e) => e.id).sort()).toEqual(
		[stillRunning.id, inBetween.id].sort(),
	);

	const weekFiltered = await db.calendarEvent.findMany(
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

	await db.enrollment.create(
		{ courseId: courseA.id, username: active.username },
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ courseId: courseA.id, username: dropped.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ courseId: courseA.id, username: dropped.username },
		FULL_ACCESS,
	);

	await db.calendarEvent.create(
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
		db.calendarEvent.findMany(
			{ courseIds: [courseA.id, courseB.id] },
			{ actor: active },
		),
	).resolves.toHaveLength(1);
	await expect(
		db.calendarEvent.findMany(
			{ courseIds: [courseA.id, courseB.id] },
			{ actor: dropped },
		),
	).resolves.toHaveLength(0);
	await expect(
		db.calendarEvent.findMany(
			{ courseIds: [courseA.id] },
			{ actor: instructor },
		),
	).resolves.toHaveLength(1);
});

test("course.read-contents agreement: findMany's visibility matches the permission over a fixture of actors", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const otherInstructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const active = await makeUser("STUDENT");
	const dropped = await makeUser("STUDENT");
	const outsider = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	await db.enrollment.create(
		{ courseId: course.id, username: active.username },
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ courseId: course.id, username: dropped.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ courseId: course.id, username: dropped.username },
		FULL_ACCESS,
	);

	await db.calendarEvent.create(
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
		instructor: { username: instructor.username },
		enrollments: [{ username: active.username }],
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
		const visible = await db.calendarEvent.findMany(
			{ courseIds: [course.id] },
			{ actor },
		);
		const expectVisible = hasPerm(actor, "course.read-contents", courseShape);
		expect(visible.length > 0, label).toBe(expectVisible);
	}
});

test("a student's event carries exam: null when the linked exam is DRAFT; the instructor's carries the exam", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);

	const event = await db.calendarEvent.create(
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
			authorId: instructor.username,
			scheduledAt: event.startAt,
			durationMs: 60 * 60_000,
		},
	});
	await relinkExam(prisma, exam.id);

	const asStudent = await db.calendarEvent.findOne(
		{ id: event.id },
		{ actor: student },
	);
	expect(asStudent?.exam).toBeNull();

	const asInstructor = await db.calendarEvent.findOne(
		{ id: event.id },
		{ actor: instructor },
	);
	expect(asInstructor?.exam).toMatchObject({ id: exam.id, title: "Midterm" });

	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "SCHEDULED" },
	});
	const asStudentAfterPublish = await db.calendarEvent.findOne(
		{ id: event.id },
		{ actor: student },
	);
	expect(asStudentAfterPublish?.exam?.id).toBe(exam.id);
});

test("upsert creates on first call, updates the same event on the second, and a different slug creates a separate event", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const created = await db.calendarEvent.upsert(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "upsert-event",
			date: "2026-01-05", // Monday, matches the slot
			week: 1,
			title: "Before",
			description: "d1",
			contentHash: tag("h"),
		},
		opts,
	);
	expect(created.title).toBe("Before");
	expect(created.description).toBe("d1");

	const updated = await db.calendarEvent.upsert(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "upsert-event",
			date: "2026-01-05",
			week: 1,
			title: "After",
			description: null,
			contentHash: tag("h"),
		},
		opts,
	);
	expect(updated.id).toBe(created.id); // same key, same row
	expect(updated.title).toBe("After"); // changed
	expect(updated.description).toBeNull(); // cleared
	expect(updated.startAt.getTime()).toBe(created.startAt.getTime()); // untouched

	const other = await db.calendarEvent.upsert(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "upsert-event-2",
			date: "2026-01-12",
			week: 2,
			title: "Other",
			contentHash: tag("h"),
		},
		opts,
	);
	expect(other.id).not.toBe(created.id);
});

test("upsert enforces the weekday-match and slot-day-collision rules, but not against the event's own current row", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts); // MONDAY

	// 2026-01-06 is a Tuesday; the slot is MONDAY.
	await expect(
		db.calendarEvent.upsert(
			{
				courseId: course.id,
				timeSlotId: slot.id,
				slug: "weekday-mismatch",
				date: "2026-01-06",
				week: 1,
				title: "t",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	const existing = await db.calendarEvent.upsert(
		{
			courseId: course.id,
			timeSlotId: slot.id,
			slug: "day-collision-existing",
			date: "2026-01-05",
			week: 1,
			title: "Existing",
			contentHash: tag("h"),
		},
		opts,
	);

	// A different event on the same slot, same local day, is refused.
	await expect(
		db.calendarEvent.upsert(
			{
				courseId: course.id,
				timeSlotId: slot.id,
				slug: "day-collision-new",
				date: "2026-01-05",
				startMin: 900,
				week: 1,
				title: "New",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	// Re-upserting the existing event on the same day must not collide with itself.
	await expect(
		db.calendarEvent.upsert(
			{
				courseId: course.id,
				timeSlotId: slot.id,
				slug: "day-collision-existing",
				date: "2026-01-05",
				week: 1,
				title: "Existing, resynced",
				contentHash: tag("h"),
			},
			opts,
		),
	).resolves.toMatchObject({ id: existing.id, title: "Existing, resynced" });
});
