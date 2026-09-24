import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotFound } from "@/core/error";
import type { TimeSlotId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";

// A random suffix, not an incrementing counter: this file's `tag()` numbering
// would otherwise collide with identically-named counters in sibling spec
// files, since they all share one test database in one `npm run test` run.
// Prefixed "cal-" so it never collides with another spec file's own prefix.
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

/** A fresh course, and the three pieces of its natural key. */
async function makeCourse(instructorUsername: string) {
	const disciplineSlug = tag("disc");
	await db.discipline.create(
		{ slug: disciplineSlug, name: disciplineSlug },
		FULL_ACCESS,
	);
	const editionSlug = await ensureEdition();
	const course = await db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructorUsername,
			edition: editionSlug,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	return {
		course,
		discipline: disciplineSlug,
		instructor: instructorUsername,
		edition: editionSlug,
	};
}

test("create rejects a zero-length slot and one running past midnight", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "a",
				day: "MONDAY",
				start: { hour: 10, minute: 0 },
				duration: { minutes: 0 },
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "d",
				day: "MONDAY",
				start: { hour: 23, minute: 20 },
				duration: { hours: 1 },
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a second slot overlapping an existing one on the same weekday in the same course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		opts,
	);

	// Overlaps [14:00, 16:00): starts inside it.
	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "mon2",
				day: "MONDAY",
				start: { hour: 15, minute: 0 },
				duration: { hours: 1 },
			},
			opts,
		),
	).rejects.toThrow();

	// Adjacent, not overlapping: starts exactly when the first ends.
	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "mon3",
				day: "MONDAY",
				start: { hour: 16, minute: 0 },
				duration: { hours: 1 },
			},
			opts,
		),
	).resolves.toMatchObject({ slug: "mon3" });

	// Different weekday, same minutes: no conflict.
	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "tue",
				day: "TUESDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			},
			opts,
		),
	).resolves.toMatchObject({ slug: "tue" });
});

test("create rejects a duplicate slug in one course, and accepts the same slug in another", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course: courseA } = await makeCourse(instructor.username);
	const { course: courseB } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await db.timeSlot.create(
		{
			course: courseA.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		opts,
	);

	await expect(
		db.timeSlot.create(
			{
				course: courseA.id,
				slug: "mon",
				day: "TUESDAY",
				start: { hour: 10, minute: 0 },
				duration: { hours: 1 },
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				course: courseB.id,
				slug: "mon",
				day: "MONDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			},
			opts,
		),
	).resolves.toMatchObject({ slug: "mon" });
});

test("update moves the hour; the slot's existing events keep their own times", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const slot = await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		opts,
	);
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

	const moved = await db.timeSlot.update(
		{ id: slot.id },
		{ start: { hour: 10, minute: 0 }, duration: { hours: 1, minutes: 30 } },
		opts,
	);
	expect(moved.start).toEqual({ hour: 10, minute: 0 });
	expect(moved.duration).toEqual({ hours: 1, minutes: 30 });

	// The event's own `startAt` was computed once at creation and is never
	// recomputed by a later slot move — moving the slot's hour does not move
	// a single row in `CalendarEvent`.
	const reloaded = await db.calendarEvent.findOne({ id: event.id }, opts);
	expect(reloaded?.startAt.getTime()).toBe(event.startAt.getTime());
});

test("delete throws while events reference the slot, naming the count, and succeeds once they are gone", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const slot = await db.timeSlot.create(
		{
			course: course.id,
			slug: "mon",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		opts,
	);
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

	await expect(db.timeSlot.delete({ id: slot.id }, opts)).rejects.toThrow(/1/);

	await db.calendarEvent.delete({ id: event.id }, opts);
	await expect(
		db.timeSlot.delete({ id: slot.id }, opts),
	).resolves.toBeUndefined();
});

test("an instructor writes their own course's slots; another instructor and a non-owning admin are forbidden; an admin who is the instructor may write", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const otherInstructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const { course } = await makeCourse(instructor.username);

	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "mon",
				day: "MONDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			},
			{ actor: instructor },
		),
	).resolves.toMatchObject({ slug: "mon" });

	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "tue",
				day: "TUESDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			},
			{ actor: otherInstructor },
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				course: course.id,
				slug: "wed",
				day: "WEDNESDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			},
			{ actor: admin },
		),
	).rejects.toThrow();

	const { course: adminCourse } = await makeCourse(admin.username);
	await expect(
		db.timeSlot.create(
			{
				course: adminCourse.id,
				slug: "mon",
				day: "MONDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			},
			{ actor: admin },
		),
	).resolves.toMatchObject({ slug: "mon" });
});

test("upsert creates on first call, updates the same slot on the second, and a different slug creates a separate slot", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const created = await db.timeSlot.upsert(
		{
			course: course.id,
			slug: "upsert-slot",
			title: "Before",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		opts,
	);
	expect(created.title).toBe("Before");

	const updated = await db.timeSlot.upsert(
		{
			course: course.id,
			slug: "upsert-slot",
			title: null,
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1, minutes: 30 },
		},
		opts,
	);
	expect(updated.id).toBe(created.id); // same key, same row
	expect(updated.duration).toEqual({ hours: 1, minutes: 30 }); // changed
	expect(updated.title).toBeNull(); // cleared
	expect(updated.day).toBe("MONDAY"); // untouched

	const other = await db.timeSlot.upsert(
		{
			course: course.id,
			slug: "upsert-slot-2",
			day: "TUESDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1 },
		},
		opts,
	);
	expect(other.id).not.toBe(created.id);
});

test("upsert enforces the overlap rule against other slots, but not against the slot's own current row", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await db.timeSlot.upsert(
		{
			course: course.id,
			slug: "existing",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 2 },
		},
		opts,
	);

	await expect(
		db.timeSlot.upsert(
			{
				course: course.id,
				slug: "overlapping",
				day: "MONDAY",
				start: { hour: 15, minute: 0 },
				duration: { hours: 1 },
			},
			opts,
		),
	).rejects.toThrow();

	// Re-upserting "existing" with a shifted window must not collide with itself.
	await expect(
		db.timeSlot.upsert(
			{
				course: course.id,
				slug: "existing",
				day: "MONDAY",
				start: { hour: 14, minute: 10 },
				duration: { hours: 2 },
			},
			opts,
		),
	).resolves.toMatchObject({ start: { hour: 14, minute: 10 } });
});

test("an upsert nested in the caller's tx rolls back with it, proving it reuses that transaction rather than opening its own", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await expect(
		prisma.$transaction(async (tx) => {
			await db.timeSlot.upsert(
				{
					course: course.id,
					slug: "tx-slot",
					day: "MONDAY",
					start: { hour: 14, minute: 0 },
					duration: { hours: 2 },
				},
				{ ...opts, tx },
			);
			throw new Error("rollback");
		}),
	).rejects.toThrow("rollback");

	const found = await db.timeSlot.findOne(
		{ course: course.id, slug: "tx-slot" },
		opts,
	);
	expect(found).toBeNull();
});

test("findOne, update and delete accept the {id} PK form", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const slot = await db.timeSlot.create(
		{
			course: course.id,
			slug: "pk-id",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1 },
		},
		opts,
	);

	const pk = { id: slot.id };
	expect(await db.timeSlot.findOne(pk, opts)).toMatchObject({ slug: "pk-id" });
	expect((await db.timeSlot.update(pk, { title: "moved" }, opts)).title).toBe(
		"moved",
	);
	await db.timeSlot.delete(pk, opts);
	expect(await db.timeSlot.findOne(pk, opts)).toBeNull();
});

test("findOne, update and delete accept the {course, slug} PK form", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const { course } = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	await db.timeSlot.create(
		{
			course: course.id,
			slug: "pk-course-slug",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1 },
		},
		opts,
	);

	const pk = { course: course.id, slug: "pk-course-slug" };
	expect(await db.timeSlot.findOne(pk, opts)).toMatchObject({
		slug: "pk-course-slug",
	});
	expect((await db.timeSlot.update(pk, { title: "moved" }, opts)).title).toBe(
		"moved",
	);
	await db.timeSlot.delete(pk, opts);
	expect(await db.timeSlot.findOne(pk, opts)).toBeNull();
});

test("findOne, update and delete accept the course-natural-key-plus-slug PK form", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const {
		course,
		discipline,
		instructor: instructorUsername,
		edition,
	} = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	await db.timeSlot.create(
		{
			course: course.id,
			slug: "pk-natural",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1 },
		},
		opts,
	);

	const pk = {
		course: { discipline, instructor: instructorUsername, edition },
		slug: "pk-natural",
	};
	expect(await db.timeSlot.findOne(pk, opts)).toMatchObject({
		slug: "pk-natural",
	});
	expect((await db.timeSlot.update(pk, { title: "moved" }, opts)).title).toBe(
		"moved",
	);
	await db.timeSlot.delete(pk, opts);
	expect(await db.timeSlot.findOne(pk, opts)).toBeNull();
});

test("create and upsert accept course as a natural key, not just its numeric id", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const {
		course,
		discipline,
		instructor: instructorUsername,
		edition,
	} = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const courseRef = { discipline, instructor: instructorUsername, edition };

	const created = await db.timeSlot.create(
		{
			course: courseRef,
			slug: "via-create",
			day: "MONDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1 },
		},
		opts,
	);
	expect(created.courseId).toBe(course.id);

	const upserted = await db.timeSlot.upsert(
		{
			course: courseRef,
			slug: "via-upsert",
			day: "TUESDAY",
			start: { hour: 14, minute: 0 },
			duration: { hours: 1 },
		},
		opts,
	);
	expect(upserted.courseId).toBe(course.id);
});

test("findOne/update/delete throw NotFound, not a bare Error, for a missing slot or a natural key naming no course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	await makeCourse(instructor.username);
	const opts = { actor: instructor };
	const missingId = { id: -1 as TimeSlotId };
	const ghostCourse = {
		course: {
			discipline: tag("ghost"),
			instructor: instructor.username,
			edition: "2026-1",
		},
		slug: "mon",
	};

	await expect(db.timeSlot.findOne(missingId, opts)).resolves.toBeNull();
	await expect(
		db.timeSlot.update(missingId, { title: "x" }, opts),
	).rejects.toBeInstanceOf(NotFound);
	await expect(db.timeSlot.delete(missingId, opts)).rejects.toBeInstanceOf(
		NotFound,
	);

	await expect(db.timeSlot.findOne(ghostCourse, opts)).rejects.toBeInstanceOf(
		NotFound,
	);
	await expect(
		db.timeSlot.create(
			{
				course: ghostCourse.course,
				slug: "mon",
				day: "MONDAY",
				start: { hour: 14, minute: 0 },
				duration: { hours: 1 },
			},
			opts,
		),
	).rejects.toBeInstanceOf(NotFound);
});
