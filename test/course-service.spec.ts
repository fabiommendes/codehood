import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import type { CourseId } from "@/core/schemas";
import { db, toEnrollmentView } from "@/db";

let uniq = 0;
function tag(prefix: string): string {
	uniq += 1;
	return `${prefix}${uniq}`;
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

async function makeDiscipline() {
	const slug = tag("disc");
	await db.discipline.create({ slug, name: slug }, FULL_ACCESS);
	return slug;
}

/** The demo edition every fixture course lives in; created once, window wide open. */
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

async function makeCourse(instructorUsername: string, disciplineSlug?: string) {
	await ensureEdition();
	return db.course.create(
		{
			discipline: disciplineSlug ?? (await makeDiscipline()),
			instructor: instructorUsername,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

test("create() rejects an edition that does not exist", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const disciplineSlug = await makeDiscipline();
	await expect(
		db.course.create(
			{
				discipline: disciplineSlug,
				instructor: instructor.username,
				edition: "2099-1",
				startAt: new Date(),
				endAt: new Date(),
			},
			FULL_ACCESS,
		),
	).rejects.toThrow();
});

test("create() rejects a duplicate discipline/instructor/edition triple", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const disciplineSlug = await makeDiscipline();
	await ensureEdition();
	await db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date(),
			endAt: new Date(),
		},
		FULL_ACCESS,
	);
	await expect(
		db.course.create(
			{
				discipline: disciplineSlug,
				instructor: instructor.username,
				edition: "2026-1",
				startAt: new Date(),
				endAt: new Date(),
			},
			FULL_ACCESS,
		),
	).rejects.toThrow();
});

test("create() rejects an instructor naming a different instructor, and allows an admin to do it", async () => {
	const instructorA = await makeUser("INSTRUCTOR");
	const instructorB = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const disciplineSlug = await makeDiscipline();
	await ensureEdition();

	await expect(
		db.course.create(
			{
				discipline: disciplineSlug,
				instructor: instructorB.username,
				edition: "2026-1",
				startAt: new Date(),
				endAt: new Date(),
			},
			{ actor: instructorA },
		),
	).rejects.toThrow();

	const course = await db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructorB.username,
			edition: "2026-1",
			startAt: new Date(),
			endAt: new Date(),
		},
		{ actor: admin },
	);
	expect(course.instructor.username).toBe(instructorB.username);
});

test("findOne returns null for a course that does not exist, and throws FORBIDDEN for one that belongs to someone else", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const outsider = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	await expect(
		db.course.findOne({ id: 999_999_999 as CourseId }, { actor: outsider }),
	).resolves.toBeNull();

	await expect(
		db.course.findOne({ id: course.id }, { actor: outsider }),
	).rejects.toThrow();

	await expect(
		db.course.findOne({ id: course.id }, { actor: instructor }),
	).resolves.toMatchObject({ id: course.id });
});

test("update, delete, and enroll throw FORBIDDEN for a student and for an instructor who does not teach the course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const otherInstructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	for (const actor of [student, otherInstructor]) {
		await expect(
			db.course.update(
				{ id: course.id },
				{ description: "x", startAt: new Date(), endAt: new Date() },
				{ actor },
			),
		).rejects.toThrow();
		await expect(
			db.course.delete({ id: course.id }, { actor }),
		).rejects.toThrow();
		await expect(
			db.enrollment.create(
				{ courseId: course.id, username: student.username },
				{ actor },
			),
		).rejects.toThrow();
	}
});

test("findMany visibility agrees with course.read over a fixture covering every row of the visibility table", async () => {
	const admin = await makeUser("ADMIN");
	const instructorA = await makeUser("INSTRUCTOR");
	const instructorB = await makeUser("INSTRUCTOR");
	const studentActive = await makeUser("STUDENT");
	const studentDropped = await makeUser("STUDENT");
	const studentElsewhere = await makeUser("STUDENT");

	const courseA = await makeCourse(instructorA.username);
	const courseB = await makeCourse(instructorB.username);

	// courseA: studentActive is ACTIVE, studentDropped is DROPPED, instructorB
	// (who teaches courseB) is also enrolled here as a student.
	await db.enrollment.create(
		{ courseId: courseA.id, username: studentActive.username },
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ courseId: courseA.id, username: studentDropped.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ courseId: courseA.id, username: studentDropped.username },
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ courseId: courseA.id, username: instructorB.username },
		FULL_ACCESS,
	);

	const everyone = await db.course.findMany({}, FULL_ACCESS);
	const fixtureCourses = everyone.filter(
		(c) => c.id === courseA.id || c.id === courseB.id,
	);

	const actors = [
		{ label: "SYSTEM", actor: SYSTEM },
		{ label: "admin", actor: admin },
		{ label: "instructorA (teaches A, not enrolled in B)", actor: instructorA },
		{ label: "instructorB (teaches B, enrolled in A)", actor: instructorB },
		{ label: "studentActive (ACTIVE in A)", actor: studentActive },
		{ label: "studentDropped (DROPPED in A)", actor: studentDropped },
		{ label: "studentElsewhere (enrolled nowhere)", actor: studentElsewhere },
	] as const;

	for (const { label, actor } of actors) {
		const visible = await db.course.findMany({}, { actor });
		const visibleIds = new Set(
			visible
				.filter((c) => c.id === courseA.id || c.id === courseB.id)
				.map((c) => c.id),
		);
		const expectedIds = new Set(
			fixtureCourses
				.filter((c) => hasPerm(actor, "course.read", toEnrollmentView(c)))
				.map((c) => c.id),
		);
		expect(visibleIds, label).toEqual(expectedIds);
	}

	// Pin the table down explicitly, not just via the predicate (which could
	// itself be wrong): a student sees their ACTIVE enrollment, not the DROPPED one.
	const asStudentActive = await db.course.findMany(
		{},
		{ actor: studentActive },
	);
	expect(asStudentActive.map((c) => c.id)).toContain(courseA.id);

	const asStudentDropped = await db.course.findMany(
		{},
		{ actor: studentDropped },
	);
	expect(asStudentDropped.map((c) => c.id)).not.toContain(courseA.id);

	// instructorB teaches courseB and is enrolled in courseA: sees both.
	const asInstructorB = await db.course.findMany({}, { actor: instructorB });
	expect(asInstructorB.map((c) => c.id)).toEqual(
		expect.arrayContaining([courseA.id, courseB.id]),
	);

	// instructorA does not see courseB: no catalog/discovery feature.
	const asInstructorA = await db.course.findMany({}, { actor: instructorA });
	expect(asInstructorA.map((c) => c.id)).not.toContain(courseB.id);
});

test("upsert creates on first call, updates the same course on the second, and a different key creates a separate course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const disciplineSlug = await makeDiscipline();
	const editionSlug = await ensureEdition();

	const created = await db.course.upsert(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: editionSlug,
			description: "Before",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	expect(created.description).toBe("Before");

	const updated = await db.course.upsert(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: editionSlug,
			description: null,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-06-01"),
		},
		FULL_ACCESS,
	);
	expect(updated.id).toBe(created.id); // same key, same row
	expect(updated.description).toBeNull(); // cleared
	expect(updated.endAt).toEqual(new Date("2026-06-01")); // changed
	expect(updated.startAt).toEqual(new Date("2026-01-01")); // untouched

	const matching = await db.course.findMany(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: editionSlug,
		},
		FULL_ACCESS,
	);
	expect(matching).toHaveLength(1);

	const otherInstructor = await makeUser("INSTRUCTOR");
	const other = await db.course.upsert(
		{
			discipline: disciplineSlug,
			instructor: otherInstructor.username,
			edition: editionSlug,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	expect(other.id).not.toBe(created.id);
});

test("upsert in a closed edition succeeds for an existing course, fails for a new one, and an actor with the outside-window permission bypasses both", async () => {
	const closedSlug = "9911";
	const closedWindow = {
		startAt: new Date("2020-01-01"),
		endAt: new Date("2020-06-01"),
	};
	await db.edition.create(
		{ slug: closedSlug, name: closedSlug, ...closedWindow },
		FULL_ACCESS,
	);
	const admin = await makeUser("ADMIN");
	const instructor = await makeUser("INSTRUCTOR");
	const disciplineSlug = await makeDiscipline();

	// Only an admin (`course.create-outside-window`) may create the first course
	// in a closed edition.
	const existing = await db.course.upsert(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: closedSlug,
			startAt: new Date("2020-01-01"),
			endAt: new Date("2020-05-01"),
		},
		{ actor: admin },
	);

	// The course already exists: an ordinary instructor may now upsert (sync)
	// it even though the edition window is closed.
	const resynced = await db.course.upsert(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: closedSlug,
			description: "resynced",
			startAt: new Date("2020-01-01"),
			endAt: new Date("2020-05-01"),
		},
		{ actor: instructor },
	);
	expect(resynced.id).toBe(existing.id);
	expect(resynced.description).toBe("resynced");

	// A genuinely new course in the same closed edition is refused for the
	// instructor...
	const disciplineSlug2 = await makeDiscipline();
	await expect(
		db.course.upsert(
			{
				discipline: disciplineSlug2,
				instructor: instructor.username,
				edition: closedSlug,
				startAt: new Date("2020-01-01"),
				endAt: new Date("2020-05-01"),
			},
			{ actor: instructor },
		),
	).rejects.toThrow(/not accepting new courses/);

	// ...but succeeds for the admin.
	const createdByAdmin = await db.course.upsert(
		{
			discipline: disciplineSlug2,
			instructor: instructor.username,
			edition: closedSlug,
			startAt: new Date("2020-01-01"),
			endAt: new Date("2020-05-01"),
		},
		{ actor: admin },
	);
	expect(createdByAdmin.edition.slug).toBe(closedSlug);
});
