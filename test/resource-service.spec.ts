import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type Resource } from "@/db";
import { groupResourcesByType } from "@/db/services/resource.service";

// A random suffix, not an incrementing counter: this file's own `tag()`
// numbering would otherwise collide with the identically-named counters in
// sibling spec files (e.g. course-service.spec.ts's `instructor1`), since
// they all share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
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
	await ensureEdition();
	return db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructorUsername,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

function link(url = "https://example.com") {
	return { type: "LINK" as const, url };
}

test("create rejects malformed `data` per type: LINK without a url, CODE without a language, MD with empty content, FILE without a buffer", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await expect(
		db.resource.create(
			{
				courseId: course.id,
				slug: "a",
				title: "t",
				data: { type: "LINK", url: "" },
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.resource.create(
			{
				courseId: course.id,
				slug: "b",
				title: "t",
				// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed input
				data: { type: "CODE", content: "print(1)" } as any,
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.resource.create(
			{
				courseId: course.id,
				slug: "c",
				title: "t",
				data: { type: "MD", content: "" },
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		db.resource.create(
			{
				courseId: course.id,
				slug: "d",
				title: "t",
				// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed input
				data: { type: "FILE", filename: "a.txt" } as any,
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a duplicate slug in one course, and accepts the same slug in another", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);

	await db.resource.create(
		{
			courseId: courseA.id,
			slug: "syllabus",
			title: "Syllabus",
			data: link("https://example.com/a"),
			ref: tag("h"),
		},
		{ actor: instructor },
	);

	await expect(
		db.resource.create(
			{
				courseId: courseA.id,
				slug: "syllabus",
				title: "Syllabus again",
				data: link("https://example.com/b"),
				ref: tag("h"),
			},
			{ actor: instructor },
		),
	).rejects.toThrow();

	await expect(
		db.resource.create(
			{
				courseId: courseB.id,
				slug: "syllabus",
				title: "Syllabus",
				data: link("https://example.com/c"),
				ref: tag("h"),
			},
			{ actor: instructor },
		),
	).resolves.toMatchObject({ slug: "syllabus" });
});

test("create stores a supplied ref verbatim", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);

	const hash = tag("verbatim-hash");
	const resource = await db.resource.create(
		{
			courseId: course.id,
			slug: "with-hash",
			title: "t",
			data: link(),
			ref: hash,
		},
		{ actor: instructor },
	);
	expect(resource.ref).toBe(hash);
});

test("groupResourcesByType: fixed type order (Files, Links, Notes, Snippets), title order within each, empty groups absent", () => {
	const base = {
		id: 0,
		description: null,
		ref: "h",
		createdAt: new Date(),
		updatedAt: new Date(),
		slug: "s",
	};
	const resources = [
		{
			...base,
			id: 1,
			title: "Zebra.py",
			data: { type: "CODE" as const, content: "1", language: "python" },
			slug: "zebra",
		},
		{
			...base,
			id: 2,
			title: "Beta link",
			data: { type: "LINK" as const, url: "https://a" },
			slug: "beta",
		},
		{
			...base,
			id: 3,
			title: "Alpha link",
			data: { type: "LINK" as const, url: "https://b" },
			slug: "alpha",
		},
		{
			...base,
			id: 4,
			title: "Notes",
			data: { type: "MD" as const, content: "# hi" },
			slug: "notes",
		},
	];

	const groups = groupResourcesByType(resources as unknown as Resource[]);
	expect(groups.map((g) => g.type)).toEqual(["LINK", "MD", "CODE"]); // FILE group absent: empty
	expect(
		groups.find((g) => g.type === "LINK")?.resources.map((r) => r.title),
	).toEqual(["Alpha link", "Beta link"]);

	// Reproducible: same input, same output, every time.
	expect(groupResourcesByType(resources as unknown as Resource[])).toEqual(
		groups,
	);
});

test("an enrolled student sees a course's resources; a non-owning admin reads but cannot write", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const active = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	await db.enrollment.create(
		{ courseId: course.id, username: active.username },
		FULL_ACCESS,
	);

	await db.resource.create(
		{
			courseId: course.id,
			slug: "syllabus",
			title: "Syllabus",
			data: link(),
			ref: tag("h"),
		},
		{ actor: instructor },
	);

	await expect(
		db.resource.findMany({ courseId: course.id }, { actor: active }),
	).resolves.toHaveLength(1);
	await expect(
		db.resource.findMany({ courseId: course.id }, { actor: admin }),
	).resolves.toHaveLength(1);

	await expect(
		db.resource.create(
			{
				courseId: course.id,
				slug: "admin-attempt",
				title: "t",
				data: link(),
				ref: tag("h"),
			},
			{ actor: admin },
		),
	).rejects.toThrow();
});

test("findMany rejects an actor who cannot see the course at all", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const outsider = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	await expect(
		db.resource.findMany({ courseId: course.id }, { actor: outsider }),
	).rejects.toThrow();
});

test("delete removes the resource row; a FILE resource's attachment survives on a sibling resource that shares the same bytes", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const buffer = Buffer.from(`shared file bytes ${tag("f")}`);

	const resourceA = await db.resource.create(
		{
			courseId: courseA.id,
			slug: "shared",
			title: "Shared file",
			data: { type: "FILE", filename: "notes.txt", buffer },
			ref: tag("h"),
		},
		{ actor: instructor },
	);
	const resourceB = await db.resource.create(
		{
			courseId: courseB.id,
			slug: "shared",
			title: "Shared file",
			data: { type: "FILE", filename: "notes.txt", buffer },
			ref: tag("h"),
		},
		{ actor: instructor },
	);

	await db.resource.delete({ id: resourceA.id }, { actor: instructor });

	await expect(
		db.resource.findOne({ id: resourceA.id }, { actor: instructor }),
	).resolves.toBeNull();

	// resourceB's own attachment (a separate row, content-addressed onto the
	// same blob) is untouched by resourceA's deletion.
	const survivors = await db.attachment.allAttachedTo(
		{
			type: "RESOURCE",
			id: resourceB.id,
			title: resourceB.title,
			slug: resourceB.slug,
		},
		FULL_ACCESS,
	);
	expect(survivors).toHaveLength(1);
	const survivor = survivors[0];
	if (!survivor) throw new Error("unreachable: length asserted above");
	expect(resourceB.data.type).toBe("FILE");
	expect(resourceB.data.type === "FILE" && resourceB.data.link).toContain(
		survivor.hash,
	);
});

test("upsert creates on first call, updates the same resource on the second, and a different slug creates a separate resource", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	const created = await db.resource.upsert(
		{
			courseId: course.id,
			slug: "upsert-resource",
			title: "Before",
			description: "d1",
			data: link("https://example.com/before"),
			ref: tag("h"),
		},
		opts,
	);
	expect(created.title).toBe("Before");
	expect(created.description).toBe("d1");

	const updated = await db.resource.upsert(
		{
			courseId: course.id,
			slug: "upsert-resource",
			title: "After",
			description: null,
			data: link("https://example.com/before"),
			ref: tag("h"),
		},
		opts,
	);
	expect(updated.id).toBe(created.id); // same key, same row
	expect(updated.title).toBe("After"); // changed
	expect(updated.description).toBeNull(); // cleared
	expect(updated.data).toEqual(link("https://example.com/before")); // untouched

	const other = await db.resource.upsert(
		{
			courseId: course.id,
			slug: "upsert-resource-2",
			title: "Other",
			data: link("https://example.com/other"),
			ref: tag("h"),
		},
		opts,
	);
	expect(other.id).not.toBe(created.id);
});

test("upsert enforces the `data` shape on both the create branch and the update branch", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const opts = { actor: instructor };

	await expect(
		db.resource.upsert(
			{
				courseId: course.id,
				slug: "shape-new",
				title: "t",
				data: { type: "LINK", url: "" },
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	const existing = await db.resource.upsert(
		{
			courseId: course.id,
			slug: "shape-existing",
			title: "t",
			data: link(),
			ref: tag("h"),
		},
		opts,
	);

	await expect(
		db.resource.upsert(
			{
				courseId: course.id,
				slug: "shape-existing",
				title: "t",
				// biome-ignore lint/suspicious/noExplicitAny: intentionally malformed input
				data: { type: "CODE", content: "x" } as any,
				ref: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	const untouched = await db.resource.findOne({ id: existing.id }, opts);
	expect(untouched?.data.type).toBe("LINK");
});

function courseRefOf(course: Awaited<ReturnType<typeof makeCourse>>) {
	return {
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	};
}

test("findOne addresses a resource by its course's natural key and slug", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const created = await db.resource.create(
		{
			courseId: course.id,
			slug: "syllabus",
			title: "Syllabus",
			data: link(),
			ref: tag("h"),
		},
		{ actor: instructor },
	);

	const found = await db.resource.findOne(
		{ ...courseRefOf(course), slug: "syllabus" },
		{ actor: instructor },
	);
	expect(found?.id).toBe(created.id);
});

async function statusOf(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return (error as { status?: number }).status;
	}
	return "resolved";
}

test("findOne by course natural key: 404 for no such course, 403 for an existing slug the actor cannot see, null for a missing slug regardless of visibility", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const outsider = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const courseRef = courseRefOf(course);

	await db.resource.create(
		{
			courseId: course.id,
			slug: "syllabus",
			title: "Syllabus",
			data: link(),
			ref: tag("h"),
		},
		{ actor: instructor },
	);

	expect(
		await statusOf(
			db.resource.findOne(
				{ ...courseRef, discipline: tag("nope"), slug: "syllabus" },
				{ actor: instructor },
			),
		),
	).toBe(404);
	expect(
		await statusOf(
			db.resource.findOne(
				{ ...courseRef, slug: "syllabus" },
				{ actor: outsider },
			),
		),
	).toBe(403);
	await expect(
		db.resource.findOne(
			{ ...courseRef, slug: "missing" },
			{ actor: instructor },
		),
	).resolves.toBeNull();
});

test("findMany by course natural key: 404 for no such course, 403 for a course the actor cannot see", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const outsider = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const courseRef = courseRefOf(course);
	await db.resource.create(
		{
			courseId: course.id,
			slug: "syllabus",
			title: "Syllabus",
			data: link(),
			ref: tag("h"),
		},
		{ actor: instructor },
	);

	expect(
		await statusOf(
			db.resource.findMany(
				{ ...courseRef, discipline: tag("nope") },
				{ actor: instructor },
			),
		),
	).toBe(404);
	expect(
		await statusOf(db.resource.findMany(courseRef, { actor: outsider })),
	).toBe(403);
	await expect(
		db.resource.findMany(courseRef, { actor: instructor }),
	).resolves.toHaveLength(1);
});

test("create and upsert accept a course natural key in place of a numeric courseId", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const courseRef = courseRefOf(course);
	const opts = { actor: instructor };

	const created = await db.resource.create(
		{
			courseId: courseRef,
			slug: "by-ref",
			title: "t",
			data: link(),
			ref: tag("h"),
		},
		opts,
	);
	expect(created.slug).toBe("by-ref");

	const first = await db.resource.upsert(
		{
			courseId: courseRef,
			slug: "upsert-by-ref",
			title: "Before",
			data: link(),
			ref: tag("h"),
		},
		opts,
	);
	const second = await db.resource.upsert(
		{
			courseId: courseRef,
			slug: "upsert-by-ref",
			title: "After",
			data: link(),
			ref: tag("h"),
		},
		opts,
	);
	expect(second.id).toBe(first.id);
	expect(second.title).toBe("After");
});

test("create: 400 without a courseId, 404 for a course natural key naming no course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const courseRef = courseRefOf(course);
	const opts = { actor: instructor };

	expect(
		await statusOf(
			db.resource.create(
				// biome-ignore lint/suspicious/noExplicitAny: intentionally missing courseId
				{ slug: "none", title: "t", data: link(), ref: tag("h") } as any,
				opts,
			),
		),
	).toBe(400);
	expect(
		await statusOf(
			db.resource.create(
				{
					courseId: { ...courseRef, discipline: tag("nope") },
					slug: "ghost",
					title: "t",
					data: link(),
					ref: tag("h"),
				},
				opts,
			),
		),
	).toBe(404);
});

// `resourceSchema.slug` is a bare `z.string().min(1)` — the service layer
// only refuses an empty slug. Kebab-case/format enforcement
// (`week-01/notes`, `Syllabus`, `-lead`, `has space`, ...) happens at the
// REST layer via route-segment matching, see
// `test/api-resource.spec.ts`'s "malformed slug" case.
test("create rejects an empty slug with a 400", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	expect(
		await statusOf(
			db.resource.create(
				{
					courseId: course.id,
					slug: "",
					title: "t",
					data: link(),
					ref: tag("h"),
				},
				{ actor: instructor },
			),
		),
	).toBe(400);
});
