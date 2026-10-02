import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";

// A random suffix, not an incrementing counter: sibling spec files share one
// test database in one run. Prefixed "gc-" so it never collides with theirs.
function tag(prefix: string): string {
	return `gc-${prefix}${Math.random().toString(36).slice(2, 10)}`;
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
	const edition = await ensureEdition();
	return db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructorUsername,
			edition,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

type Student = Awaited<ReturnType<typeof makeUser>>;

/** A course with its instructor and `n` students enrolled and active. */
async function setup(n = 2) {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const students = [];
	for (let i = 0; i < n; i++) {
		const student = await makeUser("STUDENT");
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		students.push(student);
	}
	// Tests destructure only as many students as they asked for.
	return {
		instructor,
		course,
		students: students as [Student, Student, Student],
		opts: { actor: instructor },
	};
}

function numberColumn(
	course: { id: CourseId },
	values: { username: string; value: number | string }[],
	extra: Record<string, unknown> = {},
) {
	return {
		course: course.id,
		slug: "assignments",
		title: "Assignments",
		kind: "NUMBER" as const,
		position: 0,
		rev: "r1",
		values,
		...extra,
	};
}

async function countValues(courseId: CourseId): Promise<number> {
	return prisma.gradeValue.count({ where: { column: { courseId } } });
}

test("create stores a column and findOne returns the same column, unreleased", async () => {
	const { course, students, opts } = await setup();
	const [a, b] = students;

	const created = await db.gradeColumn.create(
		{
			course: course.id,
			slug: "final",
			title: "Final grade",
			kind: "LABEL",
			position: 2,
			rev: "9f2c",
			values: [
				{ username: a.username, value: "MS" },
				{ username: b.username, value: "SS" },
			],
		},
		opts,
	);

	expect(created).toMatchObject({
		slug: "final",
		title: "Final grade",
		kind: "LABEL",
		position: 2,
		rev: "9f2c",
		releasedAt: null,
	});
	expect(created.values).toHaveLength(2);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "final" },
		opts,
	);
	expect(found).toEqual(created);
});

test("values come back ordered by username, whatever order they were sent in", async () => {
	const { course, students, opts } = await setup(3);
	const sorted = students.map((s) => s.username).sort();
	const shuffled = [sorted[2], sorted[0], sorted[1]] as string[];

	const created = await db.gradeColumn.create(
		numberColumn(
			course,
			shuffled.map((username, i) => ({ username, value: i })),
		),
		opts,
	);
	expect(created.values.map((v) => v.username)).toEqual(sorted);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(found?.values.map((v) => v.username)).toEqual(sorted);
});

test("a NUMBER column stores numbers as sent and a LABEL column stores labels as sent", async () => {
	const { course, students, opts } = await setup();
	const [a, b] = students;

	const numbers = await db.gradeColumn.create(
		numberColumn(course, [
			{ username: a.username, value: 87.456 },
			{ username: b.username, value: 0 },
		]),
		opts,
	);
	expect(numbers.values).toContainEqual({
		username: a.username,
		value: 87.456,
	});
	expect(numbers.values).toContainEqual({ username: b.username, value: 0 });

	const labels = await db.gradeColumn.create(
		numberColumn(
			course,
			[
				{ username: a.username, value: "x" },
				{ username: b.username, value: "a".repeat(32) },
			],
			{ slug: "letters", kind: "LABEL" },
		),
		opts,
	);
	expect(labels.values).toContainEqual({ username: a.username, value: "x" });
	expect(labels.values).toContainEqual({
		username: b.username,
		value: "a".repeat(32),
	});
});

test("a NUMBER column refuses a string value and writes nothing", async () => {
	const { course, students, opts } = await setup();
	const [a, b] = students;

	await expect(
		db.gradeColumn.create(
			numberColumn(course, [
				{ username: a.username, value: 10 },
				{ username: b.username, value: "ten" },
			]),
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(
		await db.gradeColumn.findOne(
			{ course: course.id, slug: "assignments" },
			opts,
		),
	).toBeNull();
	expect(await countValues(course.id)).toBe(0);
});

for (const [title, value] of [
	["NaN", Number.NaN],
	["Infinity", Number.POSITIVE_INFINITY],
] as const) {
	test(`a NUMBER column refuses ${title}`, async () => {
		const { course, students, opts } = await setup(1);

		await expect(
			db.gradeColumn.create(
				numberColumn(course, [{ username: students[0].username, value }]),
				opts,
			),
		).rejects.toBeInstanceOf(InvalidData);
		expect(await countValues(course.id)).toBe(0);
	});
}

for (const [title, value] of [
	["a number", 7],
	["an empty string", ""],
	["a 33 character string", "a".repeat(33)],
] as const) {
	test(`a LABEL column refuses ${title} and writes nothing`, async () => {
		const { course, students, opts } = await setup(2);

		await expect(
			db.gradeColumn.create(
				numberColumn(
					course,
					[
						{ username: students[0].username, value: "MS" },
						{ username: students[1].username, value },
					],
					{ kind: "LABEL" },
				),
				opts,
			),
		).rejects.toBeInstanceOf(InvalidData);

		expect(
			await db.gradeColumn.findOne(
				{ course: course.id, slug: "assignments" },
				opts,
			),
		).toBeNull();
		expect(await countValues(course.id)).toBe(0);
	});
}

test("a value that does not fit the kind on upsert refuses the write and keeps the stored column", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 5 }]),
		opts,
	);

	await expect(
		db.gradeColumn.upsert(
			numberColumn(course, [{ username: a.username, value: "five" }], {
				title: "Changed",
			}),
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(found?.title).toBe("Assignments");
	expect(found?.values).toEqual([{ username: a.username, value: 5 }]);
});

test("the same username twice in values is refused and nothing is written", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;

	// The refinement fails as a schema validation error, so only assert the
	// call rejects. The column is created first so a stub cannot pass by
	// throwing on every call.
	await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }], {
			slug: "ok",
		}),
		opts,
	);
	const before = await countValues(course.id);

	await expect(
		db.gradeColumn.create(
			numberColumn(course, [
				{ username: a.username, value: 1 },
				{ username: a.username, value: 2 },
			]),
			opts,
		),
	).rejects.toThrow();

	expect(
		await db.gradeColumn.findOne(
			{ course: course.id, slug: "assignments" },
			opts,
		),
	).toBeNull();
	expect(await countValues(course.id)).toBe(before);
});

test("a username that is not enrolled refuses the whole write with InvalidData", async () => {
	const { course, students, opts } = await setup(1);
	const outsider = await makeUser("STUDENT");

	await expect(
		db.gradeColumn.create(
			numberColumn(course, [
				{ username: students[0].username, value: 1 },
				{ username: outsider.username, value: 2 },
			]),
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(
		await db.gradeColumn.findOne(
			{ course: course.id, slug: "assignments" },
			opts,
		),
	).toBeNull();
	expect(await countValues(course.id)).toBe(0);
});

test("an unenrolled username on upsert leaves the existing values as they were", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	const outsider = await makeUser("STUDENT");
	await db.gradeColumn.create(
		numberColumn(course, [
			{ username: a.username, value: 1 },
			{ username: b.username, value: 2 },
		]),
		opts,
	);

	await expect(
		db.gradeColumn.upsert(
			numberColumn(course, [{ username: outsider.username, value: 9 }]),
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	const byName = new Map(found?.values.map((v) => [v.username, v.value]));
	expect(byName.get(a.username)).toBe(1);
	expect(byName.get(b.username)).toBe(2);
	expect(found?.values).toHaveLength(2);
});

test("an unenrolled username on update leaves the existing values as they were", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	const outsider = await makeUser("STUDENT");
	await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }]),
		opts,
	);

	await expect(
		db.gradeColumn.update(
			{ course: course.id, slug: "assignments" },
			{ values: [{ username: outsider.username, value: 9 }] },
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(found?.values).toEqual([{ username: a.username, value: 1 }]);
});

test("a student enrolled in another course only is not enrolled here", async () => {
	const { course, opts } = await setup(0);
	const other = await setup(1);

	await expect(
		db.gradeColumn.create(
			numberColumn(course, [
				{ username: other.students[0].username, value: 1 },
			]),
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);
});

test("a dropped student is accepted in values", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.enrollment.delete(
		{ course: course.id, username: a.username },
		FULL_ACCESS,
	);

	const created = await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 4 }]),
		opts,
	);
	expect(created.values).toEqual([{ username: a.username, value: 4 }]);
});

test("upsert replaces the column whole: students absent from the new values lose their value", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	await db.gradeColumn.create(
		numberColumn(course, [
			{ username: a.username, value: 1 },
			{ username: b.username, value: 2 },
		]),
		opts,
	);

	const result = await db.gradeColumn.upsert(
		numberColumn(course, [{ username: a.username, value: 3 }]),
		opts,
	);
	expect(result.values).toEqual([{ username: a.username, value: 3 }]);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(found?.values).toEqual([{ username: a.username, value: 3 }]);
	expect(await countValues(course.id)).toBe(1);
});

test("upsert on a slug that does not exist creates the column", async () => {
	const { course, students, opts } = await setup(1);

	const result = await db.gradeColumn.upsert(
		numberColumn(course, [{ username: students[0].username, value: 8 }]),
		opts,
	);

	expect(result).toMatchObject({ slug: "assignments", releasedAt: null });
	expect(
		await db.gradeColumn.findOne(
			{ course: course.id, slug: "assignments" },
			opts,
		),
	).toMatchObject({ title: "Assignments" });
});

test("upsert updates title, kind, position and rev, keeping the same column", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	const created = await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }]),
		opts,
	);

	const updated = await db.gradeColumn.upsert(
		numberColumn(course, [{ username: a.username, value: "MS" }], {
			title: "Letter",
			kind: "LABEL",
			position: 5,
			rev: "r2",
		}),
		opts,
	);

	expect(updated).toMatchObject({
		id: created.id,
		title: "Letter",
		kind: "LABEL",
		position: 5,
		rev: "r2",
	});
	expect(updated.values).toEqual([{ username: a.username, value: "MS" }]);
});

test("update with values replaces them whole", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	await db.gradeColumn.create(
		numberColumn(course, [
			{ username: a.username, value: 1 },
			{ username: b.username, value: 2 },
		]),
		opts,
	);

	const updated = await db.gradeColumn.update(
		{ course: course.id, slug: "assignments" },
		{ values: [{ username: b.username, value: 7 }] },
		opts,
	);

	expect(updated.values).toEqual([{ username: b.username, value: 7 }]);
	expect(await countValues(course.id)).toBe(1);
});

test("update without values changes only the given fields and keeps the values", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	const created = await db.gradeColumn.create(
		numberColumn(course, [
			{ username: a.username, value: 1 },
			{ username: b.username, value: 2 },
		]),
		opts,
	);

	const updated = await db.gradeColumn.update(
		{ course: course.id, slug: "assignments" },
		{ title: "Renamed", position: 4 },
		opts,
	);

	expect(updated).toMatchObject({
		title: "Renamed",
		position: 4,
		kind: "NUMBER",
		rev: "r1",
		slug: "assignments",
	});
	expect(updated.values).toEqual(created.values);
});

test("update that changes kind without values is refused and the column is unchanged", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }]),
		opts,
	);

	await expect(
		db.gradeColumn.update(
			{ course: course.id, slug: "assignments" },
			{ kind: "LABEL" },
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(found?.kind).toBe("NUMBER");
	expect(found?.values).toEqual([{ username: a.username, value: 1 }]);
});

test("update that changes kind with values that fit the new kind succeeds", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }]),
		opts,
	);

	const updated = await db.gradeColumn.update(
		{ course: course.id, slug: "assignments" },
		{ kind: "LABEL", values: [{ username: a.username, value: "SS" }] },
		opts,
	);

	expect(updated.kind).toBe("LABEL");
	expect(updated.values).toEqual([{ username: a.username, value: "SS" }]);
});

test("update that changes kind with values that do not fit it is refused", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }]),
		opts,
	);

	await expect(
		db.gradeColumn.update(
			{ course: course.id, slug: "assignments" },
			{ kind: "LABEL", values: [{ username: a.username, value: 1 }] },
			opts,
		),
	).rejects.toBeInstanceOf(InvalidData);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(found?.kind).toBe("NUMBER");
});

test("create ignores a releasedAt field and the column starts hidden", async () => {
	const { course, students, opts } = await setup(1);
	const body = numberColumn(
		course,
		[{ username: students[0].username, value: 1 }],
		{ releasedAt: new Date("2026-02-01") },
	);

	const created = await db.gradeColumn.create(body, opts);

	expect(created.releasedAt).toBeNull();
	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(found?.releasedAt).toBeNull();
});

test("upsert ignores a releasedAt field, on a new column and on an existing one", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	const body = numberColumn(course, [{ username: a.username, value: 1 }], {
		releasedAt: new Date("2026-02-01"),
	});

	const first = await db.gradeColumn.upsert(body, opts);
	expect(first.releasedAt).toBeNull();

	const second = await db.gradeColumn.upsert(body, opts);
	expect(second.releasedAt).toBeNull();
});

test("update ignores a releasedAt field", async () => {
	const { course, students, opts } = await setup(1);
	await db.gradeColumn.create(
		numberColumn(course, [{ username: students[0].username, value: 1 }]),
		opts,
	);
	const body = { title: "Renamed", releasedAt: new Date("2026-02-01") };

	const updated = await db.gradeColumn.update(
		{ course: course.id, slug: "assignments" },
		body,
		opts,
	);

	expect(updated.title).toBe("Renamed");
	expect(updated.releasedAt).toBeNull();
});

test("create refuses a slug that already exists in the course and accepts it in another course", async () => {
	const { course, students, opts } = await setup(1);
	const other = await makeCourse(opts.actor.username);
	const [a] = students;
	await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }]),
		opts,
	);

	await expect(
		db.gradeColumn.create(
			numberColumn(course, [{ username: a.username, value: 2 }], {
				title: "Again",
			}),
			opts,
		),
	).rejects.toThrow();
	const kept = await db.gradeColumn.findOne(
		{ course: course.id, slug: "assignments" },
		opts,
	);
	expect(kept?.title).toBe("Assignments");

	await expect(
		db.gradeColumn.create(numberColumn(other, []), opts),
	).resolves.toMatchObject({ slug: "assignments" });
});

test("delete removes the column and its values", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	const kept = await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 9 }], {
			slug: "kept",
		}),
		opts,
	);
	const created = await db.gradeColumn.create(
		numberColumn(course, [
			{ username: a.username, value: 1 },
			{ username: b.username, value: 2 },
		]),
		opts,
	);

	await db.gradeColumn.delete({ course: course.id, slug: "assignments" }, opts);

	expect(
		await db.gradeColumn.findOne(
			{ course: course.id, slug: "assignments" },
			opts,
		),
	).toBeNull();
	expect(
		await prisma.gradeValue.count({ where: { columnId: created.id } }),
	).toBe(0);
	expect(await prisma.gradeValue.count({ where: { columnId: kept.id } })).toBe(
		1,
	);
});

test("a student of the course and an unrelated user are refused on every write, and nothing changes", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	const unrelated = await makeUser("STUDENT");
	const unrelatedInstructor = await makeUser("INSTRUCTOR");
	const original = await db.gradeColumn.create(
		numberColumn(course, [{ username: a.username, value: 1 }]),
		opts,
	);

	for (const actor of [a, unrelated, unrelatedInstructor]) {
		const asActor = { actor };
		const key = { course: course.id, slug: "assignments" };

		await expect(
			db.gradeColumn.create(
				numberColumn(course, [{ username: a.username, value: 2 }], {
					slug: "other",
				}),
				asActor,
			),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.gradeColumn.upsert(
				numberColumn(course, [{ username: a.username, value: 3 }], {
					title: "Hacked",
				}),
				asActor,
			),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(
			db.gradeColumn.update(key, { title: "Hacked" }, asActor),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(db.gradeColumn.delete(key, asActor)).rejects.toBeInstanceOf(
			NotAllowed,
		);
	}

	expect(
		await db.gradeColumn.findOne({ course: course.id, slug: "other" }, opts),
	).toBeNull();
	expect(
		await db.gradeColumn.findOne(
			{ course: course.id, slug: "assignments" },
			opts,
		),
	).toEqual(original);
});
