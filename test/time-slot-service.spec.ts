import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
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

test("create rejects durationMin <= 0, startMin outside 0..1439, and a slot running past midnight", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "a",
				day: "MONDAY",
				startMin: 600,
				durationMin: 0,
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "b",
				day: "MONDAY",
				startMin: -1,
				durationMin: 60,
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "c",
				day: "MONDAY",
				startMin: 1440,
				durationMin: 60,
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "d",
				day: "MONDAY",
				startMin: 1400,
				durationMin: 60,
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a second slot overlapping an existing one on the same weekday in the same course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await db.timeSlot.create(
		{
			courseId: course.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);

	// Overlaps [840, 960): starts inside it.
	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "mon2",
				day: "MONDAY",
				startMin: 900,
				durationMin: 60,
			},
			opts,
		),
	).rejects.toThrow();

	// Adjacent, not overlapping: starts exactly when the first ends.
	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "mon3",
				day: "MONDAY",
				startMin: 960,
				durationMin: 60,
			},
			opts,
		),
	).resolves.toMatchObject({ slug: "mon3" });

	// Different weekday, same minutes: no conflict.
	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "tue",
				day: "TUESDAY",
				startMin: 840,
				durationMin: 120,
			},
			opts,
		),
	).resolves.toMatchObject({ slug: "tue" });
});

test("create rejects a duplicate slug in one course, and accepts the same slug in another", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await db.timeSlot.create(
		{
			courseId: courseA.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);

	await expect(
		db.timeSlot.create(
			{
				courseId: courseA.id,
				slug: "mon",
				day: "TUESDAY",
				startMin: 600,
				durationMin: 60,
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				courseId: courseB.id,
				slug: "mon",
				day: "MONDAY",
				startMin: 840,
				durationMin: 120,
			},
			opts,
		),
	).resolves.toMatchObject({ slug: "mon" });
});

test("update moves the hour; the slot's existing events keep their own times", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const slot = await db.timeSlot.create(
		{
			courseId: course.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);
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

	const moved = await db.timeSlot.update(
		{ id: slot.id },
		{ startMin: 600, durationMin: 90 },
		opts,
	);
	expect(moved.startMin).toBe(600);
	expect(moved.durationMin).toBe(90);

	const reloaded = await db.calendarEvent.findOne({ id: event.id }, opts);
	expect(reloaded?.startAt.getTime()).toBe(event.startAt.getTime());
	expect(reloaded?.durationMin).toBe(event.durationMin);
});

test("delete throws while events reference the slot, naming the count, and succeeds once they are gone", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const slot = await db.timeSlot.create(
		{
			courseId: course.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);
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
	const course = await makeCourse(instructor.username);

	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "mon",
				day: "MONDAY",
				startMin: 840,
				durationMin: 120,
			},
			{ actor: instructor },
		),
	).resolves.toMatchObject({ slug: "mon" });

	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "tue",
				day: "TUESDAY",
				startMin: 840,
				durationMin: 120,
			},
			{ actor: otherInstructor },
		),
	).rejects.toThrow();

	await expect(
		db.timeSlot.create(
			{
				courseId: course.id,
				slug: "wed",
				day: "WEDNESDAY",
				startMin: 840,
				durationMin: 120,
			},
			{ actor: admin },
		),
	).rejects.toThrow();

	const adminCourse = await makeCourse(admin.username);
	await expect(
		db.timeSlot.create(
			{
				courseId: adminCourse.id,
				slug: "mon",
				day: "MONDAY",
				startMin: 840,
				durationMin: 120,
			},
			{ actor: admin },
		),
	).resolves.toMatchObject({ slug: "mon" });
});

test("upsert creates on first call, updates the same slot on the second, and a different slug creates a separate slot", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const created = await db.timeSlot.upsert(
		{
			courseId: course.id,
			slug: "upsert-slot",
			title: "Before",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);
	expect(created.title).toBe("Before");

	const updated = await db.timeSlot.upsert(
		{
			courseId: course.id,
			slug: "upsert-slot",
			title: null,
			day: "MONDAY",
			startMin: 840,
			durationMin: 90,
		},
		opts,
	);
	expect(updated.id).toBe(created.id); // same key, same row
	expect(updated.durationMin).toBe(90); // changed
	expect(updated.title).toBeNull(); // cleared
	expect(updated.day).toBe("MONDAY"); // untouched

	const other = await db.timeSlot.upsert(
		{
			courseId: course.id,
			slug: "upsert-slot-2",
			day: "TUESDAY",
			startMin: 840,
			durationMin: 60,
		},
		opts,
	);
	expect(other.id).not.toBe(created.id);
});

test("upsert enforces the overlap rule against other slots, but not against the slot's own current row", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await db.timeSlot.upsert(
		{
			courseId: course.id,
			slug: "existing",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);

	await expect(
		db.timeSlot.upsert(
			{
				courseId: course.id,
				slug: "overlapping",
				day: "MONDAY",
				startMin: 900,
				durationMin: 60,
			},
			opts,
		),
	).rejects.toThrow();

	// Re-upserting "existing" with a shifted window must not collide with itself.
	await expect(
		db.timeSlot.upsert(
			{
				courseId: course.id,
				slug: "existing",
				day: "MONDAY",
				startMin: 850,
				durationMin: 120,
			},
			opts,
		),
	).resolves.toMatchObject({ startMin: 850 });
});

test("an upsert nested in the caller's tx rolls back with it, proving it reuses that transaction rather than opening its own", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await expect(
		prisma.$transaction(async (tx) => {
			await db.timeSlot.upsert(
				{
					courseId: course.id,
					slug: "tx-slot",
					day: "MONDAY",
					startMin: 840,
					durationMin: 120,
				},
				{ ...opts, tx },
			);
			throw new Error("rollback");
		}),
	).rejects.toThrow("rollback");

	const found = await db.timeSlot.findOne(
		{ ref: { courseId: course.id, slug: "tx-slot" } },
		opts,
	);
	expect(found).toBeNull();
});
