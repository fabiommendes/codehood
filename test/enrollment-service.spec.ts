import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotFound } from "@/core/error";
import { db } from "@/db";

function tag(prefix: string): string {
	return `enr-${prefix}${Math.random().toString(36).slice(2, 10)}`;
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

test("findMany throws for an enrolled student", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);

	await expect(
		db.enrollment.findMany({ courseId: course.id }, { actor: student }),
	).rejects.toThrow();

	const students = await db.enrollment.findMany(
		{ courseId: course.id },
		{
			actor: instructor,
		},
	);
	expect(students.map((s) => s.username)).toEqual([student.username]);
});

test("delete marks the enrollment DROPPED rather than deleting it, and create reactivates it", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	let students = await db.enrollment.findMany(
		{ courseId: course.id },
		{
			actor: instructor,
		},
	);
	expect(students).toHaveLength(1);

	await db.enrollment.delete(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	students = await db.enrollment.findMany(
		{ courseId: course.id },
		{ actor: instructor },
	);
	expect(students).toHaveLength(0);

	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	students = await db.enrollment.findMany(
		{ courseId: course.id },
		{ actor: instructor },
	);
	expect(students).toHaveLength(1);
});

test("a student drops themselves — the half of FR-CRS-042 that used to be missing", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);

	await db.enrollment.delete(
		{ courseId: course.id, username: student.username },
		{ actor: student },
	);

	const students = await db.enrollment.findMany(
		{ courseId: course.id },
		{
			actor: instructor,
		},
	);
	expect(students).toHaveLength(0);
});

test("a student naming another student's username is refused, and the other enrollment is untouched", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const studentA = await makeUser("STUDENT");
	const studentB = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await db.enrollment.create(
		{ courseId: course.id, username: studentB.username },
		FULL_ACCESS,
	);

	await expect(
		db.enrollment.delete(
			{ courseId: course.id, username: studentB.username },
			{ actor: studentA },
		),
	).rejects.toThrow();

	const students = await db.enrollment.findMany(
		{ courseId: course.id },
		{
			actor: instructor,
		},
	);
	expect(students.map((s) => s.username)).toEqual([studentB.username]);
});

test("a non-owning admin cannot drop an enrollment, list enrollments, or enroll one", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);

	await expect(
		db.enrollment.delete(
			{ courseId: course.id, username: student.username },
			{ actor: admin },
		),
	).rejects.toThrow();
	await expect(
		db.enrollment.findMany({ courseId: course.id }, { actor: admin }),
	).rejects.toThrow();
	await expect(
		db.enrollment.create(
			{ courseId: course.id, username: student.username },
			{ actor: admin },
		),
	).rejects.toThrow();
});

test("dropping an already-DROPPED enrollment is a no-op, not an error", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ courseId: course.id, username: student.username },
		{ actor: instructor },
	);

	await expect(
		db.enrollment.delete(
			{ courseId: course.id, username: student.username },
			{ actor: instructor },
		),
	).resolves.toBeUndefined();

	const students = await db.enrollment.findMany(
		{ courseId: course.id },
		{
			actor: instructor,
		},
	);
	expect(students).toHaveLength(0);
});

test("re-enrolling a dropped student restores access to submissions made before the drop", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.enrollment.delete(
		{ courseId: course.id, username: student.username },
		{ actor: student },
	);
	await expect(
		db.course.findOne({ id: course.id }, { actor: student }),
	).rejects.toThrow();

	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		{ actor: instructor },
	);
	await expect(
		db.course.findOne({ id: course.id }, { actor: student }),
	).resolves.toMatchObject({ id: course.id });
});

test("findMany carries the full student view with enrolledAt for the Students tab", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);

	const students = await db.enrollment.findMany(
		{ courseId: course.id },
		{
			actor: instructor,
		},
	);
	expect(students).toEqual([
		{
			username: student.username,
			name: student.name,
			email: student.email,
			githubId: student.githubId,
			schoolId: student.schoolId,
			courseId: course.id,
			status: "ACTIVE",
			enrolledAt: expect.any(Date),
		},
	]);
});

test("create returns the enrollment, and a cleared githubId/schoolId comes back as null", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	await db.user.update(
		{ username: student.username },
		{ githubId: null, schoolId: null },
		FULL_ACCESS,
	);
	const course = await makeCourse(instructor.username);

	const enrollment = await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		{ actor: instructor },
	);
	expect(enrollment).toMatchObject({
		username: student.username,
		courseId: course.id,
		status: "ACTIVE",
		githubId: null,
		schoolId: null,
	});
	expect(enrollment).not.toHaveProperty("passwordHash");
});

test("findOne is visible to the owner and to the student, refused to a classmate, and reports DROPPED", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const classmate = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	for (const s of [student, classmate]) {
		await db.enrollment.create(
			{ courseId: course.id, username: s.username },
			FULL_ACCESS,
		);
	}
	const pk = { courseId: course.id, username: student.username };

	await expect(
		db.enrollment.findOne(pk, { actor: instructor }),
	).resolves.toMatchObject({ status: "ACTIVE" });
	await expect(
		db.enrollment.findOne(pk, { actor: student }),
	).resolves.toMatchObject({ username: student.username });
	await expect(
		db.enrollment.findOne(pk, { actor: classmate }),
	).rejects.toThrow();

	await db.enrollment.delete(pk, FULL_ACCESS);
	await expect(
		db.enrollment.findOne(pk, { actor: instructor }),
	).resolves.toMatchObject({ status: "DROPPED" });

	const stranger = await makeUser("STUDENT");
	await expect(
		db.enrollment.findOne(
			{ courseId: course.id, username: stranger.username },
			{ actor: instructor },
		),
	).resolves.toBeNull();
});

test("findMany accepts a course natural key and a status filter", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const active = await makeUser("STUDENT");
	const dropped = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	for (const s of [active, dropped]) {
		await db.enrollment.create(
			{ courseId: course.id, username: s.username },
			FULL_ACCESS,
		);
	}
	await db.enrollment.delete(
		{ courseId: course.id, username: dropped.username },
		FULL_ACCESS,
	);

	const key = {
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	};
	const byKey = await db.enrollment.findMany(key, { actor: instructor });
	expect(byKey.map((e) => e.username)).toEqual([active.username]);

	const droppedOnly = await db.enrollment.findMany(
		{ ...key, status: "DROPPED" },
		{ actor: instructor },
	);
	expect(droppedOnly.map((e) => e.username)).toEqual([dropped.username]);
});

test("create and delete accept a course natural key", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const pk = {
		courseId: {
			discipline: course.discipline.slug,
			instructor: instructor.username,
			edition: course.edition.slug,
		},
		username: student.username,
	};

	await expect(
		db.enrollment.create(pk, { actor: instructor }),
	).resolves.toMatchObject({ courseId: course.id, status: "ACTIVE" });
	await db.enrollment.delete(pk, { actor: instructor });
	await expect(
		db.enrollment.findOne(pk, { actor: instructor }),
	).resolves.toMatchObject({ status: "DROPPED" });
});

test("an unknown course is NotFound, and update/upsert are not implemented", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const unknown = {
		discipline: "nope",
		instructor: instructor.username,
		edition: "2026-1",
	};

	await expect(
		db.enrollment.findMany(unknown, { actor: instructor }),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.enrollment.update(
			{ courseId: unknown, username: student.username },
			undefined as never,
			FULL_ACCESS,
		),
	).rejects.toThrow();
	await expect(
		db.enrollment.upsert(undefined as never, FULL_ACCESS),
	).rejects.toThrow();
});
