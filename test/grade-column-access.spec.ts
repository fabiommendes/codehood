import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotAllowed, NotFound } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";

// Random suffix: sibling spec files share one test database in one run.
function tag(prefix: string): string {
	return `ga-${prefix}${Math.random().toString(36).slice(2, 10)}`;
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

function column(
	course: { id: CourseId },
	slug: string,
	values: { username: string; value: number | string }[],
	extra: Record<string, unknown> = {},
) {
	return {
		course: course.id,
		slug,
		title: slug,
		kind: "NUMBER" as const,
		position: 0,
		rev: "r1",
		values,
		...extra,
	};
}

test("the instructor lists every column, hidden and released, with every value, ordered by position then slug", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	const values = [
		{ username: a.username, value: 1 },
		{ username: b.username, value: 2 },
	];
	await db.gradeColumn.create(
		column(course, "zeta", values, { position: 1 }),
		opts,
	);
	await db.gradeColumn.create(
		column(course, "beta", values, { position: 1 }),
		opts,
	);
	await db.gradeColumn.create(
		column(course, "omega", values, { position: 5 }),
		opts,
	);
	await db.gradeColumn.create(
		column(course, "alpha", values, { position: 0 }),
		opts,
	);
	await db.gradeColumn.release({ course: course.id, slug: "beta" }, opts);

	const found = await db.gradeColumn.findMany({ course: course.id }, opts);

	expect(found.map((c) => c.slug)).toEqual(["alpha", "beta", "zeta", "omega"]);
	expect(found.map((c) => c.releasedAt !== null)).toEqual([
		false,
		true,
		false,
		false,
	]);
	for (const c of found) expect(c.values).toHaveLength(2);
});

test("an enrolled student lists released columns only, each with their own value alone", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	const values = [
		{ username: a.username, value: 10 },
		{ username: b.username, value: 20 },
	];
	await db.gradeColumn.create(column(course, "hidden", values), opts);
	await db.gradeColumn.create(
		column(course, "shown", values, { position: 1 }),
		opts,
	);
	await db.gradeColumn.release({ course: course.id, slug: "shown" }, opts);

	const found = await db.gradeColumn.findMany(
		{ course: course.id },
		{ actor: a },
	);

	expect(found.map((c) => c.slug)).toEqual(["shown"]);
	expect(found[0]?.values).toEqual([{ username: a.username, value: 10 }]);
});

test("a released column where the student has no value reads with empty values, in findMany and findOne", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	await db.gradeColumn.create(
		column(course, "shown", [{ username: b.username, value: 20 }]),
		opts,
	);
	await db.gradeColumn.release({ course: course.id, slug: "shown" }, opts);

	const listed = await db.gradeColumn.findMany(
		{ course: course.id },
		{ actor: a },
	);
	expect(listed).toHaveLength(1);
	expect(listed[0]?.values).toEqual([]);

	const one = await db.gradeColumn.findOne(
		{ course: course.id, slug: "shown" },
		{ actor: a },
	);
	expect(one?.values).toEqual([]);
});

test("a student's findOne is null on a hidden column and returns only their own value on a released one", async () => {
	const { course, students, opts } = await setup(2);
	const [a, b] = students;
	const values = [
		{ username: a.username, value: 10 },
		{ username: b.username, value: 20 },
	];
	await db.gradeColumn.create(column(course, "hidden", values), opts);
	await db.gradeColumn.create(column(course, "shown", values), opts);
	await db.gradeColumn.release({ course: course.id, slug: "shown" }, opts);

	expect(
		await db.gradeColumn.findOne(
			{ course: course.id, slug: "hidden" },
			{ actor: a },
		),
	).toBeNull();
	const shown = await db.gradeColumn.findOne(
		{ course: course.id, slug: "shown" },
		{ actor: a },
	);
	expect(shown?.values).toEqual([{ username: a.username, value: 10 }]);
});

test("a user with no relation to the course is refused with NotAllowed on findMany and on findOne, released or not", async () => {
	const { course, students, opts } = await setup(1);
	const outsider = await makeUser("STUDENT");
	const values = [{ username: students[0].username, value: 1 }];
	await db.gradeColumn.create(column(course, "hidden", values), opts);
	await db.gradeColumn.create(column(course, "shown", values), opts);
	await db.gradeColumn.release({ course: course.id, slug: "shown" }, opts);

	await expect(
		db.gradeColumn.findMany({ course: course.id }, { actor: outsider }),
	).rejects.toBeInstanceOf(NotAllowed);
	for (const slug of ["hidden", "shown"]) {
		await expect(
			db.gradeColumn.findOne({ course: course.id, slug }, { actor: outsider }),
		).rejects.toBeInstanceOf(NotAllowed);
	}
});

test("a student whose enrollment is dropped is refused like an outsider, though their value is stored", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.gradeColumn.create(
		column(course, "shown", [{ username: a.username, value: 1 }]),
		opts,
	);
	await db.gradeColumn.release({ course: course.id, slug: "shown" }, opts);
	await db.enrollment.delete(
		{ course: course.id, username: a.username },
		FULL_ACCESS,
	);

	await expect(
		db.gradeColumn.findMany({ course: course.id }, { actor: a }),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.gradeColumn.findOne({ course: course.id, slug: "shown" }, { actor: a }),
	).rejects.toBeInstanceOf(NotAllowed);
});

test("findOne of a missing slug is null for the instructor, and a course reference that resolves to no course is NotFound", async () => {
	const { course, instructor, students, opts } = await setup(1);
	await db.gradeColumn.create(
		column(course, "real", [{ username: students[0].username, value: 1 }]),
		opts,
	);
	const ghost = {
		discipline: tag("ghost"),
		instructor: instructor.username,
		edition: "2026-1",
	};

	expect(
		await db.gradeColumn.findOne({ course: course.id, slug: "missing" }, opts),
	).toBeNull();
	await expect(
		db.gradeColumn.findOne({ course: ghost, slug: "real" }, opts),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.gradeColumn.findMany({ course: ghost }, opts),
	).rejects.toBeInstanceOf(NotFound);
});

test("release sets releasedAt to about now, returns the column, and the student then reads it", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.gradeColumn.create(
		column(course, "final", [{ username: a.username, value: 1 }]),
		opts,
	);
	const before = Date.now();

	const released = await db.gradeColumn.release(
		{ course: course.id, slug: "final" },
		opts,
	);

	expect(released.slug).toBe("final");
	expect(released.releasedAt).toBeInstanceOf(Date);
	expect(Math.abs((released.releasedAt?.getTime() ?? 0) - before)).toBeLessThan(
		30_000,
	);
	const seen = await db.gradeColumn.findOne(
		{ course: course.id, slug: "final" },
		{ actor: a },
	);
	expect(seen?.values).toEqual([{ username: a.username, value: 1 }]);
});

test("releasing a released column returns it with the same releasedAt", async () => {
	const { course, students, opts } = await setup(1);
	await db.gradeColumn.create(
		column(course, "final", [{ username: students[0].username, value: 1 }]),
		opts,
	);
	const key = { course: course.id, slug: "final" };
	const first = await db.gradeColumn.release(key, opts);
	await new Promise((resolve) => setTimeout(resolve, 20));

	const second = await db.gradeColumn.release(key, opts);

	expect(second.releasedAt?.getTime()).toBe(first.releasedAt?.getTime());
	expect(second.releasedAt).not.toBeNull();
});

test("upsert and update of a released column keep releasedAt and the student reads the new value at once", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	await db.gradeColumn.create(
		column(course, "final", [{ username: a.username, value: 1 }]),
		opts,
	);
	const key = { course: course.id, slug: "final" };
	const released = await db.gradeColumn.release(key, opts);

	const upserted = await db.gradeColumn.upsert(
		column(course, "final", [{ username: a.username, value: 2 }]),
		opts,
	);
	expect(upserted.releasedAt?.getTime()).toBe(released.releasedAt?.getTime());
	const afterUpsert = await db.gradeColumn.findOne(key, { actor: a });
	expect(afterUpsert?.values).toEqual([{ username: a.username, value: 2 }]);

	const updated = await db.gradeColumn.update(
		key,
		{ values: [{ username: a.username, value: 3 }] },
		opts,
	);
	expect(updated.releasedAt?.getTime()).toBe(released.releasedAt?.getTime());
	const afterUpdate = await db.gradeColumn.findOne(key, { actor: a });
	expect(afterUpdate?.values).toEqual([{ username: a.username, value: 3 }]);
});

test("a column created after another was released starts hidden", async () => {
	const { course, students, opts } = await setup(1);
	const values = [{ username: students[0].username, value: 1 }];
	await db.gradeColumn.create(column(course, "first", values), opts);
	await db.gradeColumn.release({ course: course.id, slug: "first" }, opts);

	const second = await db.gradeColumn.create(
		column(course, "second", values),
		opts,
	);

	expect(second.releasedAt).toBeNull();
});

test("an enrolled student releasing gets NotFound on a hidden column and NotAllowed on a released one, and releasedAt is unchanged", async () => {
	const { course, students, opts } = await setup(1);
	const [a] = students;
	const values = [{ username: a.username, value: 1 }];
	await db.gradeColumn.create(column(course, "hidden", values), opts);
	await db.gradeColumn.create(column(course, "shown", values), opts);
	const shown = await db.gradeColumn.release(
		{ course: course.id, slug: "shown" },
		opts,
	);

	await expect(
		db.gradeColumn.release({ course: course.id, slug: "hidden" }, { actor: a }),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.gradeColumn.release({ course: course.id, slug: "shown" }, { actor: a }),
	).rejects.toBeInstanceOf(NotAllowed);

	const hidden = await db.gradeColumn.findOne(
		{ course: course.id, slug: "hidden" },
		opts,
	);
	expect(hidden?.releasedAt).toBeNull();
	const still = await db.gradeColumn.findOne(
		{ course: course.id, slug: "shown" },
		opts,
	);
	expect(still?.releasedAt?.getTime()).toBe(shown.releasedAt?.getTime());
});

test("an unrelated user releasing is refused and the column stays hidden", async () => {
	const { course, students, opts } = await setup(1);
	const outsider = await makeUser("STUDENT");
	await db.gradeColumn.create(
		column(course, "final", [{ username: students[0].username, value: 1 }]),
		opts,
	);

	const error = await db.gradeColumn
		.release({ course: course.id, slug: "final" }, { actor: outsider })
		.then(
			() => null,
			(e: unknown) => e,
		);
	expect(error instanceof NotFound || error instanceof NotAllowed).toBe(true);

	const found = await db.gradeColumn.findOne(
		{ course: course.id, slug: "final" },
		opts,
	);
	expect(found?.releasedAt).toBeNull();
});

test("release on a slug that does not exist rejects with NotFound", async () => {
	const { course, students, opts } = await setup(1);
	await db.gradeColumn.create(
		column(course, "real", [{ username: students[0].username, value: 1 }]),
		opts,
	);

	await expect(
		db.gradeColumn.release({ course: course.id, slug: "missing" }, opts),
	).rejects.toBeInstanceOf(NotFound);
});
