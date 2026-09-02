import { expect, test } from "@playwright/test";
import { calendarEventService } from "@/db/calendar-event.service";
import { FULL_ACCESS } from "@/db/base-service";
import { courseService } from "@/db/course.service";
import { disciplineService } from "@/db/discipline.service";
import { editionService } from "@/db/edition.service";
import { timeSlotService } from "@/db/time-slot.service";
import { userService } from "@/db/user.service";

// A random suffix, not an incrementing counter: this file's `tag()` numbering
// would otherwise collide with identically-named counters in sibling spec
// files, since they all share one test database in one `npm run test` run.
// Prefixed "cal-" so it never collides with another spec file's own prefix.
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

test("create rejects durationMin <= 0, startMin outside 0..1439, and a slot running past midnight", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await expect(
		timeSlotService.create(
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
		timeSlotService.create(
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
		timeSlotService.create(
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
		timeSlotService.create(
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

	await timeSlotService.create(
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
		timeSlotService.create(
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
		timeSlotService.create(
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
		timeSlotService.create(
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

	await timeSlotService.create(
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
		timeSlotService.create(
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
		timeSlotService.create(
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

	const slot = await timeSlotService.create(
		{
			courseId: course.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);
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

	const moved = await timeSlotService.update(
		{ id: slot.id },
		{ startMin: 600, durationMin: 90 },
		opts,
	);
	expect(moved.startMin).toBe(600);
	expect(moved.durationMin).toBe(90);

	const reloaded = await calendarEventService.findOne({ id: event.id }, opts);
	expect(reloaded?.startAt.getTime()).toBe(event.startAt.getTime());
	expect(reloaded?.durationMin).toBe(event.durationMin);
});

test("delete throws while events reference the slot, naming the count, and succeeds once they are gone", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const slot = await timeSlotService.create(
		{
			courseId: course.id,
			slug: "mon",
			day: "MONDAY",
			startMin: 840,
			durationMin: 120,
		},
		opts,
	);
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

	await expect(timeSlotService.delete({ id: slot.id }, opts)).rejects.toThrow(
		/1/,
	);

	await calendarEventService.delete({ id: event.id }, opts);
	await expect(
		timeSlotService.delete({ id: slot.id }, opts),
	).resolves.toBeUndefined();
});

test("an instructor writes their own course's slots; another instructor and a non-owning admin are forbidden; an admin who is the instructor may write", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const otherInstructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const course = await makeCourse(instructor.username);

	await expect(
		timeSlotService.create(
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
		timeSlotService.create(
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
		timeSlotService.create(
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
		timeSlotService.create(
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
