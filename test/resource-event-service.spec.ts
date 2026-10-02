import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { NotAllowed, NotFound } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";

// A random suffix, not an incrementing counter: shared test database across
// spec files. Prefixed "rev-" so it never collides with another file's tag().
function tag(prefix: string): string {
	return `rev-${prefix}${Math.random().toString(36).slice(2, 10)}`;
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
	return db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructorUsername,
			edition: await ensureEdition(),
			startAt: new Date("2026-01-05T12:00:00Z"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

/// A course with one slot per entry in `slots` (slug to weekday) and an event
/// for each given [slot slug, week] pair.
async function makeCourseWithEvents(
	events: [slot: string, week: number][],
	slots: Record<string, "MONDAY" | "TUESDAY" | "WEDNESDAY"> = {
		mon: "MONDAY",
		tue: "TUESDAY",
	},
) {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };
	for (const [slug, day] of Object.entries(slots)) {
		await db.timeSlot.create(
			{
				course: course.id,
				slug,
				day,
				start: { hour: 14, minute: 0 },
				duration: { hours: 2 },
			},
			opts,
		);
	}
	const created: Record<string, number> = {};
	for (const [slot, week] of events) {
		const event = await db.calendarEvent.create(
			{
				course: course.id,
				timeSlot: slot,
				week,
				title: `${slot} w${week}`,
				rev: tag("h"),
			},
			opts,
		);
		created[`${slot}:${week}`] = event.id;
	}
	return { course, opts, ids: created, instructor };
}

function linkData() {
	return { type: "LINK" as const, url: "https://example.com" };
}

async function resourceRowCount(courseId: CourseId, slug: string) {
	const found = await db.resource.findOne(
		{ course: courseId, slug },
		{ actor: SYSTEM },
	);
	return found ? 1 : 0;
}

// A1 -------------------------------------------------------------------------

test("create with an event key returns the event's id, week and slot slug, and findOne agrees", async () => {
	const { course, opts, ids } = await makeCourseWithEvents([
		["mon", 1],
		["mon", 3],
		["tue", 3],
	]);

	const created = await db.resource.create(
		{
			course: course.id,
			slug: "slides",
			title: "Slides",
			data: linkData(),
			event: { week: 3, timeSlot: "tue" },
		},
		opts,
	);
	expect(created.event).toEqual({ id: ids["tue:3"], week: 3, timeSlot: "tue" });

	const found = await db.resource.findOne(
		{ course: course.id, slug: "slides" },
		opts,
	);
	expect(found?.event).toEqual({ id: ids["tue:3"], week: 3, timeSlot: "tue" });

	const byId = await db.resource.findOne({ id: created.id }, opts);
	expect(byId?.event).toEqual({ id: ids["tue:3"], week: 3, timeSlot: "tue" });
});

for (const [label, extra] of [
	["omitted", {}],
	["null", { event: null }],
] as const) {
	test(`create with event ${label} gives a general resource (event null)`, async () => {
		const { course, opts } = await makeCourseWithEvents([["mon", 1]]);

		const created = await db.resource.create(
			{
				course: course.id,
				slug: "general",
				title: "General",
				data: linkData(),
				...extra,
			},
			opts,
		);
		expect(created.event).toBeNull();

		const found = await db.resource.findOne(
			{ course: course.id, slug: "general" },
			opts,
		);
		expect(found?.event).toBeNull();
	});
}

test("upsert creating a resource with an event key attaches it to that event", async () => {
	const { course, opts, ids } = await makeCourseWithEvents([["mon", 2]]);

	const created = await db.resource.upsert(
		{
			course: course.id,
			slug: "up-new",
			title: "Up",
			data: linkData(),
			event: { week: 2, timeSlot: "mon" },
		},
		opts,
	);
	expect(created.event).toEqual({ id: ids["mon:2"], week: 2, timeSlot: "mon" });

	const found = await db.resource.findOne(
		{ course: course.id, slug: "up-new" },
		opts,
	);
	expect(found?.event).toEqual({ id: ids["mon:2"], week: 2, timeSlot: "mon" });
});

test("create resolves the key in the resource's own course when another course has an event with the same week and slot slug", async () => {
	const a = await makeCourseWithEvents([["mon", 1]]);
	const b = await makeCourseWithEvents([["mon", 1]]);

	const created = await db.resource.create(
		{
			course: b.course.id,
			slug: "same-key",
			title: "Same key",
			data: linkData(),
			event: { week: 1, timeSlot: "mon" },
		},
		b.opts,
	);
	expect(created.event?.id).toBe(b.ids["mon:1"]);
	expect(created.event?.id).not.toBe(a.ids["mon:1"]);
});

// A2 -------------------------------------------------------------------------

const unknownKeys: [string, { week: number; timeSlot: string }][] = [
	["an unknown week", { week: 9, timeSlot: "mon" }],
	["an unknown slot slug", { week: 1, timeSlot: "nope" }],
	[
		"a slot that exists but has no event in that week",
		{ week: 1, timeSlot: "tue" },
	],
];

for (const [label, key] of unknownKeys) {
	test(`create rejects ${label} with NotFound and writes nothing`, async () => {
		const { course, opts } = await makeCourseWithEvents([["mon", 1]]);
		const slug = tag("res");

		await expect(
			db.resource.create(
				{
					course: course.id,
					slug,
					title: "t",
					data: linkData(),
					event: key,
				},
				opts,
			),
		).rejects.toBeInstanceOf(NotFound);

		expect(await resourceRowCount(course.id, slug)).toBe(0);
	});
}

test("create rejects a slot slug and week that exist only in another course with NotFound and writes nothing", async () => {
	const { course, opts } = await makeCourseWithEvents([["mon", 1]]);
	// The other course owns slot "wed" and an event at week 5.
	const other = await makeCourseWithEvents([["wed", 5]], { wed: "WEDNESDAY" });
	const slug = tag("res");

	await expect(
		db.resource.create(
			{
				course: course.id,
				slug,
				title: "t",
				data: linkData(),
				event: { week: 5, timeSlot: "wed" },
			},
			opts,
		),
	).rejects.toBeInstanceOf(NotFound);

	expect(await resourceRowCount(course.id, slug)).toBe(0);
	expect(await resourceRowCount(other.course.id, slug)).toBe(0);
});

test("upsert creating rejects an unknown event key with NotFound and writes nothing", async () => {
	const { course, opts } = await makeCourseWithEvents([["mon", 1]]);
	const slug = tag("res");

	await expect(
		db.resource.upsert(
			{
				course: course.id,
				slug,
				title: "t",
				data: linkData(),
				event: { week: 7, timeSlot: "mon" },
			},
			opts,
		),
	).rejects.toBeInstanceOf(NotFound);

	expect(await resourceRowCount(course.id, slug)).toBe(0);
});

test("update rejects an unknown event key with NotFound and keeps the resource where it was", async () => {
	const { course, opts, ids } = await makeCourseWithEvents([["mon", 1]]);
	const created = await db.resource.create(
		{
			course: course.id,
			slug: "stay",
			title: "Stay",
			data: linkData(),
			event: { week: 1, timeSlot: "mon" },
		},
		opts,
	);

	await expect(
		db.resource.update(
			{ id: created.id },
			{ title: "Changed", event: { week: 8, timeSlot: "mon" } },
			opts,
		),
	).rejects.toBeInstanceOf(NotFound);

	const after = await db.resource.findOne({ id: created.id }, opts);
	expect(after?.title).toBe("Stay");
	expect(after?.event?.id).toBe(ids["mon:1"]);
});

// A3 -------------------------------------------------------------------------

test("update with an event key moves the resource to that event", async () => {
	const { course, opts, ids } = await makeCourseWithEvents([
		["mon", 1],
		["tue", 2],
	]);
	const created = await db.resource.create(
		{
			course: course.id,
			slug: "move",
			title: "Move",
			data: linkData(),
			event: { week: 1, timeSlot: "mon" },
		},
		opts,
	);

	const moved = await db.resource.update(
		{ id: created.id },
		{ event: { week: 2, timeSlot: "tue" } },
		opts,
	);
	expect(moved.event).toEqual({ id: ids["tue:2"], week: 2, timeSlot: "tue" });

	const found = await db.resource.findOne({ id: created.id }, opts);
	expect(found?.event?.id).toBe(ids["tue:2"]);
});

test("update with an event key attaches a general resource", async () => {
	const { course, opts, ids } = await makeCourseWithEvents([["mon", 1]]);
	const created = await db.resource.create(
		{ course: course.id, slug: "attach", title: "A", data: linkData() },
		opts,
	);
	expect(created.event).toBeNull();

	const attached = await db.resource.update(
		{ id: created.id },
		{ event: { week: 1, timeSlot: "mon" } },
		opts,
	);
	expect(attached.event?.id).toBe(ids["mon:1"]);
});

test("update with event null detaches the resource", async () => {
	const { course, opts } = await makeCourseWithEvents([["mon", 1]]);
	const created = await db.resource.create(
		{
			course: course.id,
			slug: "detach",
			title: "D",
			data: linkData(),
			event: { week: 1, timeSlot: "mon" },
		},
		opts,
	);
	expect(created.event).not.toBeNull();

	const detached = await db.resource.update(
		{ id: created.id },
		{ event: null },
		opts,
	);
	expect(detached.event).toBeNull();

	const found = await db.resource.findOne({ id: created.id }, opts);
	expect(found?.event).toBeNull();
});

test("update without event leaves the resource attached", async () => {
	const { course, opts, ids } = await makeCourseWithEvents([["mon", 1]]);
	const created = await db.resource.create(
		{
			course: course.id,
			slug: "keep",
			title: "Keep",
			data: linkData(),
			event: { week: 1, timeSlot: "mon" },
		},
		opts,
	);

	const updated = await db.resource.update(
		{ id: created.id },
		{ title: "Renamed" },
		opts,
	);
	expect(updated.title).toBe("Renamed");
	expect(updated.event?.id).toBe(ids["mon:1"]);

	const found = await db.resource.findOne({ id: created.id }, opts);
	expect(found?.event?.id).toBe(ids["mon:1"]);
});

test("upsert of an existing resource without event detaches it", async () => {
	const { course, opts } = await makeCourseWithEvents([["mon", 1]]);
	const created = await db.resource.create(
		{
			course: course.id,
			slug: "put",
			title: "Put",
			data: linkData(),
			event: { week: 1, timeSlot: "mon" },
		},
		opts,
	);
	expect(created.event).not.toBeNull();

	const again = await db.resource.upsert(
		{ course: course.id, slug: "put", title: "Put", data: linkData() },
		opts,
	);
	expect(again.id).toBe(created.id);
	expect(again.event).toBeNull();

	const found = await db.resource.findOne({ id: created.id }, opts);
	expect(found?.event).toBeNull();
});

test("upsert of an existing resource with an event key (re)attaches it", async () => {
	const { course, opts, ids } = await makeCourseWithEvents([
		["mon", 1],
		["tue", 2],
	]);
	const created = await db.resource.create(
		{ course: course.id, slug: "reattach", title: "R", data: linkData() },
		opts,
	);

	const attached = await db.resource.upsert(
		{
			course: course.id,
			slug: "reattach",
			title: "R",
			data: linkData(),
			event: { week: 1, timeSlot: "mon" },
		},
		opts,
	);
	expect(attached.id).toBe(created.id);
	expect(attached.event?.id).toBe(ids["mon:1"]);

	const moved = await db.resource.upsert(
		{
			course: course.id,
			slug: "reattach",
			title: "R",
			data: linkData(),
			event: { week: 2, timeSlot: "tue" },
		},
		opts,
	);
	expect(moved.id).toBe(created.id);
	expect(moved.event).toEqual({ id: ids["tue:2"], week: 2, timeSlot: "tue" });
});

test.describe("batch 2: filter, event deletion, access", () => {
	// A4 -----------------------------------------------------------------------

	async function seedFilterCourse() {
		const ctx = await makeCourseWithEvents([
			["mon", 1],
			["tue", 2],
		]);
		const { course, opts } = ctx;
		const make = (title: string, event?: { week: number; timeSlot: string }) =>
			db.resource.create(
				{
					course: course.id,
					slug: tag("r"),
					title,
					data: linkData(),
					event,
				},
				opts,
			);
		// Created out of title order on purpose.
		await make("d-general");
		await make("c-mon", { week: 1, timeSlot: "mon" });
		await make("b-general");
		await make("a-mon", { week: 1, timeSlot: "mon" });
		await make("z-tue", { week: 2, timeSlot: "tue" });
		await make("m-tue", { week: 2, timeSlot: "tue" });
		return ctx;
	}

	test("findMany with an event id lists only that event's resources, by title", async () => {
		const { course, opts, ids } = await seedFilterCourse();

		const mon = await db.resource.findMany(
			{ course: course.id, event: ids["mon:1"] as never },
			opts,
		);
		expect(mon.map((r) => r.title)).toEqual(["a-mon", "c-mon"]);
		expect(mon.every((r) => r.event?.id === ids["mon:1"])).toBe(true);

		const tue = await db.resource.findMany(
			{ course: course.id, event: ids["tue:2"] as never },
			opts,
		);
		expect(tue.map((r) => r.title)).toEqual(["m-tue", "z-tue"]);
	});

	test("findMany with event null lists general resources only, by title", async () => {
		const { course, opts } = await seedFilterCourse();

		const general = await db.resource.findMany(
			{ course: course.id, event: null },
			opts,
		);
		expect(general.map((r) => r.title)).toEqual(["b-general", "d-general"]);
	});

	test("findMany with event omitted lists every resource of the course, by title", async () => {
		const { course, opts } = await seedFilterCourse();

		const all = await db.resource.findMany({ course: course.id }, opts);
		expect(all.map((r) => r.title)).toEqual([
			"a-mon",
			"b-general",
			"c-mon",
			"d-general",
			"m-tue",
			"z-tue",
		]);
	});

	test("findMany with an event that has no resources returns an empty list", async () => {
		const { course, opts, ids } = await makeCourseWithEvents([["mon", 1]]);
		await db.resource.create(
			{ course: course.id, slug: "g", title: "G", data: linkData() },
			opts,
		);

		await expect(
			db.resource.findMany(
				{ course: course.id, event: ids["mon:1"] as never },
				opts,
			),
		).resolves.toEqual([]);
	});

	// A5 -----------------------------------------------------------------------

	test("deleting the event keeps the resource, which reads as general afterwards", async () => {
		const { course, opts, ids } = await makeCourseWithEvents([
			["mon", 1],
			["mon", 2],
		]);
		const attached = await db.resource.create(
			{
				course: course.id,
				slug: "orphan",
				title: "Orphan",
				data: linkData(),
				event: { week: 1, timeSlot: "mon" },
			},
			opts,
		);
		const sibling = await db.resource.create(
			{
				course: course.id,
				slug: "sibling",
				title: "Sibling",
				data: linkData(),
				event: { week: 2, timeSlot: "mon" },
			},
			opts,
		);
		// Guard against a vacuous pass: the stub never attaches.
		expect(attached.event?.id).toBe(ids["mon:1"]);

		await db.calendarEvent.delete({ id: ids["mon:1"] as never }, opts);

		const after = await db.resource.findOne({ id: attached.id }, opts);
		expect(after).not.toBeNull();
		expect(after?.event).toBeNull();

		const general = await db.resource.findMany(
			{ course: course.id, event: null },
			opts,
		);
		expect(general.map((r) => r.slug)).toEqual(["orphan"]);

		const untouched = await db.resource.findOne({ id: sibling.id }, opts);
		expect(untouched?.event?.id).toBe(ids["mon:2"]);
	});

	// A6 -----------------------------------------------------------------------

	async function seedAccess() {
		const { course, opts, ids } = await makeCourseWithEvents([["mon", 1]]);
		const member = await makeUser("STUDENT");
		await db.enrollment.create(
			{ course: course.id, username: member.username },
			FULL_ACCESS,
		);
		const other = await makeCourseWithEvents([["mon", 1]]);
		const outsider = await makeUser("STUDENT");
		await db.enrollment.create(
			{ course: other.course.id, username: outsider.username },
			FULL_ACCESS,
		);
		const resource = await db.resource.create(
			{
				course: course.id,
				slug: "private",
				title: "Private",
				data: linkData(),
				event: { week: 1, timeSlot: "mon" },
			},
			opts,
		);
		return { course, member, outsider, resource, eventId: ids["mon:1"] };
	}

	test("a student of the course reads an event resource, event included", async () => {
		const { course, member, resource, eventId } = await seedAccess();

		const byId = await db.resource.findOne(
			{ id: resource.id },
			{ actor: member },
		);
		expect(byId?.event).toEqual({ id: eventId, week: 1, timeSlot: "mon" });

		const bySlug = await db.resource.findOne(
			{ course: course.id, slug: "private" },
			{ actor: member },
		);
		expect(bySlug?.event?.id).toBe(eventId);
	});

	test("a student enrolled only in another course cannot read an event resource by id", async () => {
		const { outsider, resource } = await seedAccess();

		await expect(
			db.resource.findOne({ id: resource.id }, { actor: outsider }),
		).rejects.toBeInstanceOf(NotAllowed);
	});

	test("a student enrolled only in another course cannot read an event resource by course and slug", async () => {
		const { course, outsider } = await seedAccess();

		await expect(
			db.resource.findOne(
				{ course: course.id, slug: "private" },
				{ actor: outsider },
			),
		).rejects.toBeInstanceOf(NotAllowed);
	});
});
