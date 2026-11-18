import { FULL_ACCESS } from "@/auth/actor";
import { isoDate } from "@/core/schemas/base";
import { db, type schema } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { tag } from "./conditional-write-exam-support";
import { type APIRequestContext, expect, test } from "./fixtures";

/**
 * `GET /api/course/<d>/<c>/exam/<slug>/questions` reads the questions of the
 * caller's own attempt through the exam grant: a thin layer over
 * `db.examQuestion.forAttempt`, where no grant is a 404.
 */

const EDITION = "2097-1";
const PASSWORD = "correct-horse-battery-staple";

async function headersOf(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

/** A student with a known password, enrolled in the course. */
async function enrollWithPassword(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({
		role: "STUDENT",
		password: PASSWORD,
	});
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/** A course with one published question and two exams over it: one open, one scheduled for later. */
async function world(request: APIRequestContext) {
	const instructor = await persistedUserFactory.create({
		role: "INSTRUCTOR",
		password: PASSWORD,
	});
	if (!(await db.edition.findOne({ slug: EDITION }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: EDITION,
				name: EDITION,
				startDate: isoDate.parse("2026-01-01"),
				endDate: isoDate.parse("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: EDITION,
	});
	const slug = tag("q-");
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "v1",
			question: { ...capitalChoice, id: slug },
		},
		FULL_ACCESS,
	);
	const examOf = (fields: Record<string, unknown>) =>
		persistedExamFactory.create({
			course: course.id,
			slug: tag("exam-"),
			type: "EXAM",
			status: "SCHEDULED",
			duration: { minutes: 60 },
			questions: [{ slug }],
			...fields,
		});
	const open = await examOf({ scheduledAt: new Date(Date.now() - 600_000) });
	const later = await examOf({
		scheduledAt: new Date(Date.now() + 86_400_000),
	});
	const student = await enrollWithPassword(course.id);
	const classmate = await enrollWithPassword(course.id);
	const urlOf = (exam: { slug: string }) =>
		`/api/course/${course.discipline.slug}/${instructor.username}_${EDITION}/exam/${exam.slug}/questions`;
	const as = (user: { username: string }) => headersOf(request, user.username);
	return { course, instructor, student, classmate, open, later, urlOf, as };
}

test("the student with an attempt reads the questions of the grant", async ({
	request,
}) => {
	const w = await world(request);
	await db.response.create(
		{ course: w.course.id, exam: w.open.slug },
		{ actor: w.student as never },
	);
	const headers = await w.as(w.student);

	const res = await request.get(w.urlOf(w.open), { headers });
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body).toMatchObject({ view: "answer", answering: true });
	expect(body.questions).toHaveLength(1);
	expect(body.questions[0]).toMatchObject({ version: "v1", weight: 1 });
	expect(body.questions[0].question.type).toBe("multiple-choice");
});

test("without a grant the route answers 404", async ({ request }) => {
	const w = await world(request);
	await db.response.create(
		{ course: w.course.id, exam: w.open.slug },
		{ actor: w.student as never },
	);

	await test.step("a student who never started the exam", async () => {
		const headers = await w.as(w.classmate);
		const res = await request.get(w.urlOf(w.open), { headers });
		expect(res.status()).toBe(404);
	});
	await test.step("an exam that is not open yet", async () => {
		const headers = await w.as(w.student);
		const res = await request.get(w.urlOf(w.later), { headers });
		expect(res.status()).toBe(404);
	});
	await test.step("an exam that does not exist", async () => {
		const headers = await w.as(w.student);
		const res = await request.get(w.urlOf({ slug: "nope" }), { headers });
		expect(res.status()).toBe(404);
	});
});

test("the instructor has no attempt of their own to read", async ({
	request,
}) => {
	const w = await world(request);
	const headers = await w.as(w.instructor);
	const res = await request.get(w.urlOf(w.open), { headers });
	expect(res.status()).toBe(404);
});
