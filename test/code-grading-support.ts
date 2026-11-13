import { readFileSync } from "node:fs";
import path from "node:path";
import { parseQuestion, resolveTests } from "mdq";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { seedUser } from "./stories/helpers";

/// Arranges a graded `EXAM` with the Elm example question, whose sends a bot corrects through the job service, for the specs of the code review and grading pages.

const EXAMPLE_DIR = path.join(
	process.cwd(),
	"workers/chalk-worker/example/questions/elm",
);

/// The Elm example question (worker `elm-test`, 4 sends, discount 0.2) with its test sources read from disk.
function elmQuestion() {
	const parsed = parseQuestion(
		readFileSync(path.join(EXAMPLE_DIR, "soma.md"), "utf8"),
	);
	if (parsed.type !== "code") throw new Error("soma.md is not a code question");
	const texts = Object.fromEntries(
		(parsed.tests ?? []).flatMap((source) =>
			source.origin
				? [
						[
							source.origin,
							readFileSync(path.join(EXAMPLE_DIR, source.origin), "utf8"),
						],
					]
				: [],
		),
	);
	return resolveTests(parsed, texts);
}

export type Verdict = "pass" | "fail";

/// The verdict of each case of the example question: two public (`Pre.elm`), then two hidden (`Hidden.elm`).
export interface Verdicts {
	empty: Verdict;
	one: Verdict;
	long: Verdict;
	negatives: Verdict;
}

/// Every case with the same verdict.
export const all = (verdict: Verdict): Verdicts => ({
	empty: verdict,
	one: verdict,
	long: verdict,
	negatives: verdict,
});

/// The runner report of the example question.
export function elmReport(verdicts: Verdicts): object {
	const failure = (expected: string, actual: string) => ({
		message: `Expected ${expected} but got ${actual}`,
		expected,
		actual,
	});
	return {
		status: "completed",
		runner: { name: "chalk-worker", version: "0.1.0", language: "elm" },
		cases: [
			{
				source: 0,
				line: 12,
				id: "vazia",
				verdict: verdicts.empty,
				...(verdicts.empty === "fail" ? failure("0", "1") : {}),
			},
			{
				source: 0,
				line: 13,
				id: "um",
				verdict: verdicts.one,
				...(verdicts.one === "fail" ? failure("7", "0") : {}),
			},
			{
				source: 1,
				line: 12,
				id: "longa",
				verdict: verdicts.long,
				...(verdicts.long === "fail" ? failure("55", "1") : {}),
			},
			{
				source: 1,
				line: 14,
				id: "negativos",
				verdict: verdicts.negatives,
				...(verdicts.negatives === "fail" ? failure("-3", "0") : {}),
			},
		],
	};
}

export const QUESTION = "elm-soma";
export const WORKER = "elm-test";

type Student = Awaited<ReturnType<typeof seedUser>>;

/** A course with an open `EXAM` on the Elm question, and the helpers that send and correct. */
export async function codeWorld() {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: QUESTION,
			question: elmQuestion(),
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "code-exam",
		title: "Elm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: QUESTION }],
	});
	const bot = { actor: { ...instructor, bot: "runner" } };
	const href = `${courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	})}/exams/${exam.slug}`;

	const world = {
		instructor,
		course,
		exam,
		href,
		bot,
		/// An enrolled student.
		async student(username: string): Promise<Student> {
			const student = await seedUser({ role: "STUDENT", username });
			await db.enrollment.create(
				{ course: course.id, username: student.username },
				FULL_ACCESS,
			);
			return student;
		},
		/// Sends `payload` as `student` and returns the submission's id.
		async send(student: Student, payload: string): Promise<string> {
			const response = await db.response.submit(
				{
					course: course.id,
					exam: exam.slug,
					question: QUESTION,
					payload,
					kind: "SUBMIT",
				},
				{ actor: student },
			);
			return response.submissions.at(-1)?.publicId ?? "";
		},
		/// Has the bot claim the oldest queued job, which must be `submission`'s.
		async claim(submission: string): Promise<void> {
			const [job] = await db.gradingJob.claim(
				{ workers: [WORKER], limit: 1 },
				bot,
			);
			if (job?.submission !== submission) {
				throw new Error(`claimed ${job?.submission}, not ${submission}`);
			}
		},
		/// Sends `payload` and has the bot correct it with `verdicts`.
		async sendAndGrade(
			student: Student,
			payload: string,
			verdicts: Verdicts,
		): Promise<string> {
			const submission = await world.send(student, payload);
			await world.claim(submission);
			await db.gradingJob.complete(submission, elmReport(verdicts), bot);
			return submission;
		},
		/// Sends `payload` and has the worker fail it until the job gives up.
		async sendAndCrash(
			student: Student,
			payload: string,
			error: string,
		): Promise<string> {
			const submission = await world.send(student, payload);
			for (let attempt = 1; attempt <= 3; attempt++) {
				await world.claim(submission);
				await db.gradingJob.fail(submission, { error, retry: true }, bot);
			}
			return submission;
		},
		/// Closes the attempt of each student, completes the exam and releases the grades.
		async close(students: Student[]): Promise<void> {
			for (const student of students) {
				await db.response.finish(
					{ course: course.id, exam: exam.slug },
					{ actor: student },
				);
			}
			await prisma.exam.update({
				where: { id: exam.id },
				data: {
					status: "COMPLETED",
					gradesReleasedAt: new Date(Date.now() - 1000),
				},
			});
		},
	};
	return world;
}

/// A correct answer and a wrong one to the example question.
export const CORRECT =
	"module Main exposing (soma)\n\nsoma : List Int -> Int\nsoma xs =\n    List.foldl (+) 0 xs\n";
export const PARTIAL =
	"module Main exposing (soma)\n\nsoma : List Int -> Int\nsoma xs =\n    List.sum (List.filter (\\x -> x > 0) xs)\n";
