import { expect, test } from "@playwright/test";
import { canViewCourse } from "@/auth/permissions";
import { FULL_ACCESS } from "@/core/actor";
import { SYSTEM } from "@/core/actor";
import { courseService } from "@/db/services/course.service";
import { disciplineService } from "@/db/services/discipline.service";
import { editionService } from "@/db/services/edition.service";
import { userService } from "@/db/services/user.service";

let uniq = 0;
function tag(prefix: string): string {
	uniq += 1;
	return `${prefix}${uniq}`;
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

async function makeDiscipline() {
	const slug = tag("disc");
	await disciplineService.create({ slug, name: slug }, FULL_ACCESS);
	return slug;
}

/** The demo edition every fixture course lives in; created once, window wide open. */
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

async function makeCourse(instructorUsername: string, disciplineSlug?: string) {
	await ensureEdition();
	return courseService.create(
		{
			disciplineSlug: disciplineSlug ?? (await makeDiscipline()),
			instructorUsername,
			editionSlug: "2026-1",
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
		courseService.create(
			{
				disciplineSlug,
				instructorUsername: instructor.username,
				editionSlug: "2099-1",
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
	await courseService.create(
		{
			disciplineSlug,
			instructorUsername: instructor.username,
			editionSlug: "2026-1",
			startAt: new Date(),
			endAt: new Date(),
		},
		FULL_ACCESS,
	);
	await expect(
		courseService.create(
			{
				disciplineSlug,
				instructorUsername: instructor.username,
				editionSlug: "2026-1",
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
		courseService.create(
			{
				disciplineSlug,
				instructorUsername: instructorB.username,
				editionSlug: "2026-1",
				startAt: new Date(),
				endAt: new Date(),
			},
			{ actor: instructorA },
		),
	).rejects.toThrow();

	const course = await courseService.create(
		{
			disciplineSlug,
			instructorUsername: instructorB.username,
			editionSlug: "2026-1",
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
		courseService.findOne({ id: 999_999_999 }, { actor: outsider }),
	).resolves.toBeNull();

	await expect(
		courseService.findOne({ id: course.id }, { actor: outsider }),
	).rejects.toThrow();

	await expect(
		courseService.findOne({ id: course.id }, { actor: instructor }),
	).resolves.toMatchObject({ id: course.id });
});

test("update, delete, and enroll throw FORBIDDEN for a student and for an instructor who does not teach the course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const otherInstructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	for (const actor of [student, otherInstructor]) {
		await expect(
			courseService.update({ id: course.id }, { description: "x" }, { actor }),
		).rejects.toThrow();
		await expect(
			courseService.delete({ id: course.id }, { actor }),
		).rejects.toThrow();
		await expect(
			courseService.enroll(
				{ courseId: course.id, userId: student.id },
				{ actor },
			),
		).rejects.toThrow();
	}
});

test("listStudents throws for an enrolled student", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);

	await expect(
		courseService.listStudents(course.id, { actor: student }),
	).rejects.toThrow();

	const students = await courseService.listStudents(course.id, {
		actor: instructor,
	});
	expect(students.map((s) => s.id)).toEqual([student.id]);
});

test("unenroll marks the enrollment DROPPED rather than deleting it, and re-enroll reactivates it", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);
	let students = await courseService.listStudents(course.id, {
		actor: instructor,
	});
	expect(students).toHaveLength(1);

	await courseService.drop(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);
	students = await courseService.listStudents(course.id, { actor: instructor });
	expect(students).toHaveLength(0);

	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);
	students = await courseService.listStudents(course.id, { actor: instructor });
	expect(students).toHaveLength(1);
});

test("findMany visibility agrees with canViewCourse over a fixture covering every row of the visibility table", async () => {
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
	await courseService.enroll(
		{ courseId: courseA.id, userId: studentActive.id },
		FULL_ACCESS,
	);
	await courseService.enroll(
		{ courseId: courseA.id, userId: studentDropped.id },
		FULL_ACCESS,
	);
	await courseService.drop(
		{ courseId: courseA.id, userId: studentDropped.id },
		FULL_ACCESS,
	);
	await courseService.enroll(
		{ courseId: courseA.id, userId: instructorB.id },
		FULL_ACCESS,
	);

	const everyone = await courseService.findMany({}, FULL_ACCESS);
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
		const visible = await courseService.findMany({}, { actor });
		const visibleIds = new Set(
			visible
				.filter((c) => c.id === courseA.id || c.id === courseB.id)
				.map((c) => c.id),
		);
		const expectedIds = new Set(
			fixtureCourses.filter((c) => canViewCourse(actor, c)).map((c) => c.id),
		);
		expect(visibleIds, label).toEqual(expectedIds);
	}

	// Pin the table down explicitly, not just via the predicate (which could
	// itself be wrong): a student sees their ACTIVE enrollment, not the DROPPED one.
	const asStudentActive = await courseService.findMany(
		{},
		{ actor: studentActive },
	);
	expect(asStudentActive.map((c) => c.id)).toContain(courseA.id);

	const asStudentDropped = await courseService.findMany(
		{},
		{ actor: studentDropped },
	);
	expect(asStudentDropped.map((c) => c.id)).not.toContain(courseA.id);

	// instructorB teaches courseB and is enrolled in courseA: sees both.
	const asInstructorB = await courseService.findMany(
		{},
		{ actor: instructorB },
	);
	expect(asInstructorB.map((c) => c.id)).toEqual(
		expect.arrayContaining([courseA.id, courseB.id]),
	);

	// instructorA does not see courseB: no catalog/discovery feature.
	const asInstructorA = await courseService.findMany(
		{},
		{ actor: instructorA },
	);
	expect(asInstructorA.map((c) => c.id)).not.toContain(courseB.id);
});

test("a student drops themselves — the half of FR-CRS-042 that used to be missing", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);

	await courseService.drop(
		{ courseId: course.id, userId: student.id },
		{ actor: student },
	);

	const students = await courseService.listStudents(course.id, {
		actor: instructor,
	});
	expect(students).toHaveLength(0);
});

test("a student naming another student's userId is refused, and the other enrollment is untouched", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const studentA = await makeUser("STUDENT");
	const studentB = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await courseService.enroll(
		{ courseId: course.id, userId: studentB.id },
		FULL_ACCESS,
	);

	await expect(
		courseService.drop(
			{ courseId: course.id, userId: studentB.id },
			{ actor: studentA },
		),
	).rejects.toThrow();

	const students = await courseService.listStudents(course.id, {
		actor: instructor,
	});
	expect(students.map((s) => s.id)).toEqual([studentB.id]);
});

test("a non-owning admin cannot drop an enrollment, list students, or enroll one", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);

	await expect(
		courseService.drop(
			{ courseId: course.id, userId: student.id },
			{ actor: admin },
		),
	).rejects.toThrow();
	await expect(
		courseService.listStudents(course.id, { actor: admin }),
	).rejects.toThrow();
	await expect(
		courseService.enroll(
			{ courseId: course.id, userId: student.id },
			{ actor: admin },
		),
	).rejects.toThrow();
});

test("dropping an already-DROPPED enrollment is a no-op, not an error", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);
	await courseService.drop(
		{ courseId: course.id, userId: student.id },
		{ actor: instructor },
	);

	await expect(
		courseService.drop(
			{ courseId: course.id, userId: student.id },
			{ actor: instructor },
		),
	).resolves.toBeUndefined();

	const students = await courseService.listStudents(course.id, {
		actor: instructor,
	});
	expect(students).toHaveLength(0);
});

test("re-enrolling a dropped student restores access to submissions made before the drop", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);
	await courseService.drop(
		{ courseId: course.id, userId: student.id },
		{ actor: student },
	);
	await expect(
		courseService.findOne({ id: course.id }, { actor: student }),
	).rejects.toThrow();

	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		{ actor: instructor },
	);
	await expect(
		courseService.findOne({ id: course.id }, { actor: student }),
	).resolves.toMatchObject({ id: course.id });
});

test("listStudents carries enrolledAt for the Students tab", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await courseService.enroll(
		{ courseId: course.id, userId: student.id },
		FULL_ACCESS,
	);

	const students = await courseService.listStudents(course.id, {
		actor: instructor,
	});
	expect(students[0].enrolledAt).toBeInstanceOf(Date);
});
