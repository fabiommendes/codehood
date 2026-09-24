import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import type { CourseId } from "@/core/schemas";
import { db, type ServiceOpts } from "@/db";
import { localDateOf, weekdayOf } from "@/utils/schedule-time";

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
			// A Monday in SERVER_TZ (09:00 local), so a MONDAY slot's week 0
			// lands exactly on the course's start date.
			startAt: new Date("2026-01-05T12:00:00Z"),
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
		{
			course: courseId,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		opts,
	);
}

test("create derives startAt and the timeSlot shape from the slot, offset by week", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const week1 = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "Intro",
			ref: tag("h"),
		},
		opts,
	);
	expect(week1.timeSlot.id).toBe(slot.id);
	expect(week1.timeSlot.duration).toEqual(slot.duration);
	expect(week1.timeSlot.start).toEqual(slot.start);
	expect(weekdayOf(week1.startAt)).toBe("MONDAY");

	const week3 = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 3,
			title: "Later",
			ref: tag("h"),
		},
		opts,
	);
	// Three weeks later than week 1, same slot.
	expect(week3.startAt.getTime() - week1.startAt.getTime()).toBe(
		2 * 7 * 24 * 60 * 60_000,
	);
});

test("week 0 on the course's own start weekday is the start date, not a week later", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const week0 = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 0,
			title: "First class",
			ref: tag("h"),
		},
		opts,
	);

	expect(localDateOf(week0.startAt)).toBe(localDateOf(course.startAt));
	expect(weekdayOf(week0.startAt)).toBe("MONDAY");
});

test("create rejects a slot belonging to another course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slotA = await makeSlot(courseA.id, opts);

	await expect(
		db.calendarEvent.create(
			{
				course: courseB.id,
				timeSlot: slotA.id,
				week: 1,
				title: "Intro",
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a second event on the same (course, week, slot)", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "Intro",
			ref: tag("h"),
		},
		opts,
	);

	await expect(
		db.calendarEvent.create(
			{
				course: course.id,
				timeSlot: slot.id,
				week: 1,
				title: "Intro, again",
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a missing ref; update stores the supplied one verbatim", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	await expect(
		db.calendarEvent.create(
			{
				course: course.id,
				timeSlot: slot.id,
				week: 1,
				title: "Intro",
				ref: "",
			},
			opts,
		),
	).rejects.toThrow();

	const event = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "Intro",
			ref: tag("h"),
		},
		opts,
	);

	const newHash = tag("verbatim");
	const updated = await db.calendarEvent.update(
		{ id: event.id },
		{ ref: newHash },
		opts,
	);
	expect(updated.ref).toBe(newHash);
});

test("delete removes the row; a subsequent findOne returns null (no archive)", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const event = await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "Intro",
			ref: tag("h"),
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
			course: courseB.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 10, minute: 0 },
			duration: { hours: 1 },
		},
		opts,
	);

	// courseA/slotA week 0: runs 14:00-16:00 on the course's own start week —
	// still running at a `from` of 15:00.
	const stillRunning = await db.calendarEvent.create(
		{
			course: courseA.id,
			timeSlot: slotA.id,
			week: 0,
			kind: "HOLIDAY",
			title: "Still running at from",
			ref: tag("h"),
		},
		opts,
	);
	// courseA/slotA week 1: one week later — strictly inside [from, to), the
	// ordering/kind-filter fixture.
	const inBetween = await db.calendarEvent.create(
		{
			course: courseA.id,
			timeSlot: slotA.id,
			week: 1,
			kind: "HOLIDAY",
			title: "In between",
			ref: tag("h"),
		},
		opts,
	);
	// courseB/slotB week 2: two weeks later than courseA's own week 0 — later
	// than `inBetween` regardless of the two slots' different start times.
	// Its own `startAt` becomes `to`, so it is excluded by exclusivity.
	const startsAtTo = await db.calendarEvent.create(
		{
			course: courseB.id,
			timeSlot: slotB.id,
			week: 2,
			kind: "CANCELLED",
			title: "Starts exactly at to",
			ref: tag("h"),
		},
		opts,
	);

	const from = new Date(stillRunning.startAt.getTime() + 60 * 60_000); // 1h into stillRunning's window
	const to = startsAtTo.startAt;

	const results = await db.calendarEvent.findMany(
		{ courseIds: [courseA.id, courseB.id], from, to },
		opts,
	);
	expect(results.map((r) => r.id)).toEqual([stillRunning.id, inBetween.id]);

	const kindFiltered = await db.calendarEvent.findMany(
		{ courseIds: [courseA.id, courseB.id], kinds: ["HOLIDAY"] },
		opts,
	);
	expect(kindFiltered.every((e) => e.kind === "HOLIDAY")).toBe(true);
	expect(kindFiltered.map((e) => e.id).sort()).toEqual(
		[stillRunning.id, inBetween.id].sort(),
	);

	const weekFiltered = await db.calendarEvent.findMany(
		{ courseIds: [courseA.id, courseB.id], weeks: [1] },
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
		{ course: courseA.id, username: active.username },
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ course: courseA.id, username: dropped.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ course: courseA.id, username: dropped.username },
		FULL_ACCESS,
	);

	await db.calendarEvent.create(
		{
			course: courseA.id,
			timeSlot: slotA.id,
			week: 1,
			title: "Intro",
			ref: tag("h"),
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
		{ course: course.id, username: active.username },
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ course: course.id, username: dropped.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ course: course.id, username: dropped.username },
		FULL_ACCESS,
	);

	await db.calendarEvent.create(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "Intro",
			ref: tag("h"),
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

test("upsert creates on first call, updates the same event on the second, and a different week creates a separate event", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	const created = await db.calendarEvent.upsert(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "Before",
			description: "d1",
			ref: tag("h"),
		},
		opts,
	);
	expect(created.title).toBe("Before");
	expect(created.description).toBe("d1");

	const updated = await db.calendarEvent.upsert(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "After",
			description: null,
			ref: tag("h"),
		},
		opts,
	);
	expect(updated.id).toBe(created.id); // same key, same row
	expect(updated.title).toBe("After"); // changed
	expect(updated.description).toBeNull(); // cleared
	expect(updated.startAt.getTime()).toBe(created.startAt.getTime()); // untouched

	const other = await db.calendarEvent.upsert(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 2,
			title: "Other",
			ref: tag("h"),
		},
		opts,
	);
	expect(other.id).not.toBe(created.id);
});

test("upsert is gated on course.update-contents whether creating or updating", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const outsider = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await makeSlot(course.id, opts);

	await expect(
		db.calendarEvent.upsert(
			{
				course: course.id,
				timeSlot: slot.id,
				week: 1,
				title: "t",
				ref: tag("h"),
			},
			{ actor: outsider },
		),
	).rejects.toThrow();

	const existing = await db.calendarEvent.upsert(
		{
			course: course.id,
			timeSlot: slot.id,
			week: 1,
			title: "Existing",
			ref: tag("h"),
		},
		opts,
	);

	await expect(
		db.calendarEvent.upsert(
			{
				course: course.id,
				timeSlot: slot.id,
				week: 1,
				title: "Existing, resynced",
				ref: tag("h"),
			},
			{ actor: outsider },
		),
	).rejects.toThrow();

	await expect(
		db.calendarEvent.upsert(
			{
				course: course.id,
				timeSlot: slot.id,
				week: 1,
				title: "Existing, resynced",
				ref: tag("h"),
			},
			opts,
		),
	).resolves.toMatchObject({ id: existing.id, title: "Existing, resynced" });
});
