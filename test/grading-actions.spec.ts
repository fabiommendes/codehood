import { scoreValue } from "@/core/score";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { REVERT_REF_PREFIX } from "@/services/grading";
import {
	enroll,
	makeCourse,
	makeExam,
	makeQuestion,
} from "./conditional-write-exam-support";
import { type APIRequestContext, expect, test } from "./fixtures";
import { seedUser } from "./stories/helpers";

// `grading.gradeUnanswered` and `grading.revert` are called the way a browser form does, `POST /_actions/<name>`.

/// A closed exam whose student left a question unanswered, with the form fields that address it.
async function world() {
	// The instructor needs a known password to log in; `makeCourse` also ensures the edition.
	const { course: seeded } = await makeCourse();
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: seeded.edition.slug,
	});
	const student = await enroll(course.id);
	const question = await makeQuestion(course.id);
	const exam = await makeExam(course.id, {
		status: "COMPLETED",
		questions: [{ slug: question.slug }],
	});
	return {
		course,
		instructor,
		student,
		question,
		exam,
		url: {
			discipline: course.discipline.slug,
			course: `${instructor.username}_${course.edition.slug}`,
			exam: exam.slug,
		},
	};
}

async function asInstructor(
	request: APIRequestContext,
	user: { username: string; password: string },
) {
	const login = await request.post("/api/auth/login", {
		data: { login: user.username, password: user.password },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

test("grading.gradeUnanswered turns the typed percentage into a fraction of the stored pass", async ({
	request,
}) => {
	const w = await world();
	const headers = await asInstructor(request, w.instructor);

	const response = await request.post("/_actions/grading.gradeUnanswered", {
		headers,
		data: {
			...w.url,
			author: w.student.username,
			question: w.question.slug,
			score: "75",
			comment: "on the board",
		},
	});

	expect(response.ok(), await response.text()).toBe(true);
	const pass = await prisma.feedback.findFirstOrThrow({
		where: { submission: { response: { examId: w.exam.id } } },
	});
	expect(scoreValue(pass.score)).toBe(0.75);
	expect(pass.feedback).toBe("on the board");
});

test("grading.gradeUnanswered refuses a score that is not a whole percentage and writes nothing", async ({
	request,
}) => {
	const w = await world();
	const headers = await asInstructor(request, w.instructor);

	const response = await request.post("/_actions/grading.gradeUnanswered", {
		headers,
		data: {
			...w.url,
			author: w.student.username,
			question: w.question.slug,
			score: "150",
		},
	});

	expect(response.ok()).toBe(false);
	expect(
		await prisma.submission.count({
			where: { response: { examId: w.exam.id } },
		}),
	).toBe(0);
});

test("grading.revert writes a new revert pass over the instructor's grade and keeps the history", async ({
	request,
}) => {
	const w = await world();
	const headers = await asInstructor(request, w.instructor);
	const created = await db.manualGrade.gradeUnanswered(
		{
			course: w.course.id,
			exam: w.exam.slug,
			author: w.student.username,
			question: w.question.slug,
			score: "1",
		},
		{
			actor: {
				username: w.instructor.username,
				name: w.instructor.name,
				role: "INSTRUCTOR",
			},
		},
	);

	const response = await request.post("/_actions/grading.revert", {
		headers,
		data: { ...w.url, submission: created.publicId },
	});

	expect(response.ok(), await response.text()).toBe(true);
	const passes = await prisma.feedback.findMany({
		where: { submission: { publicId: created.publicId } },
		orderBy: { id: "asc" },
	});
	expect(passes).toHaveLength(2);
	expect(passes[1]?.ref.startsWith(REVERT_REF_PREFIX)).toBe(true);
	expect(scoreValue(passes[1]?.score ?? "")).toBe(0);
});
