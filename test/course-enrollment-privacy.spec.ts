import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

/**
 * `courseSchema` used to declare `enrollments: userInfo.array()`, so every
 * course read handed the full roster (name + username of every classmate) to
 * any actor who could see the course at all — a plain `ACTIVE` enrollment was
 * enough. That contradicted `enrollmentService.findMany`'s own documented
 * rule that students cannot list their classmates. `Course` now exposes
 * `enrollmentCount` instead; the roster stays behind
 * `enrollmentService.findMany`, which enforces `enrollment.read`.
 */

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const PASSWORD = "correct-horse-battery-staple";

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

/** A course taught by a fresh instructor, with one ACTIVE student enrolled. */
async function makeCourseWithStudent() {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const disciplineSlug = tag("disc");
	await db.discipline.create(
		{ slug: disciplineSlug, name: disciplineSlug },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: "2026-1" }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: "2026-1",
				name: "2026-1",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	return { instructor, student, course, disciplineSlug };
}

test("a student's ACTIVE enrollment reads the course with no roster, only a count", async () => {
	const { student, course } = await makeCourseWithStudent();

	const seen = await db.course.findOne({ id: course.id }, { actor: student });

	expect(seen).not.toBeNull();
	expect(seen).not.toHaveProperty("enrollments");
	expect(seen?.enrollmentCount).toBe(1);
});

test("the owning instructor and an admin get the same shape: no roster, correct enrollmentCount", async () => {
	const { instructor, course } = await makeCourseWithStudent();
	const admin = await makeUser("ADMIN");

	for (const actor of [instructor, admin]) {
		const seen = await db.course.findOne({ id: course.id }, { actor });
		expect(seen).not.toHaveProperty("enrollments");
		expect(seen?.enrollmentCount).toBe(1);
	}
});

test("GET /api/course/... as an enrolled student does not carry the roster over HTTP", async ({
	request,
}) => {
	const { instructor, student, disciplineSlug } = await makeCourseWithStudent();

	const login = await request.post("/api/auth/login", {
		data: { login: student.username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();

	const res = await request.get(
		`/api/course/${disciplineSlug}/${instructor.username}_2026-1`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);

	expect(res.ok()).toBe(true);
	const body = await res.json();
	expect(body).not.toHaveProperty("enrollments");
	expect(body.enrollmentCount).toBe(1);
});
