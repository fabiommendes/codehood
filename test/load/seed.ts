/**
 * Seeds the load-test database: one course, an open quiz of Elm `code`
 * questions and essays, `--students` enrolled students and the instructor's
 * `BOT` key for the worker.
 *
 * Run by `test/load/run.ts` against a fresh database, with `DATABASE_URL`
 * pointing at it:
 *
 *     DATABASE_URL=file:./load.db tsx test/load/seed.ts --students 100
 */

import { parseArgs } from "node:util";
import { FULL_ACCESS } from "@/auth/actor";
import { hashToken } from "@/auth/token";
import type { CourseId } from "@/core/schemas/base";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { localDateOf } from "@/utils/schedule-time";
import {
	answerOf,
	CODE_QUESTIONS,
	codeQuestionDocument,
	ESSAY_QUESTIONS,
} from "./questions";
import { LOAD } from "./setup";

const { values } = parseArgs({
	options: {
		students: { type: "string", default: "100" },
		history: { type: "string", default: "0" },
		"history-bytes": { type: "string", default: "900" },
	},
});
const students = Number(values.students);
const history = Number(values.history);
/// Mean size of an autosave of the history, in characters.
const historyBytes = Number(values["history-bytes"]);

const now = new Date();
const instructor = await db.user.create(
	{
		email: `${LOAD.instructor}@load.local`,
		username: LOAD.instructor,
		name: "Load Teacher",
		role: "INSTRUCTOR",
		password: LOAD.password,
		githubId: LOAD.instructor,
		schoolId: LOAD.instructor,
	},
	FULL_ACCESS,
);
await db.discipline.create(
	{ slug: LOAD.discipline, name: "Load test" },
	FULL_ACCESS,
);
await db.edition.create(
	{
		slug: LOAD.edition,
		name: LOAD.edition,
		startDate: localDateOf(new Date(now.getTime() - 30 * 86_400_000)),
		endDate: localDateOf(new Date(now.getTime() + 90 * 86_400_000)),
	},
	FULL_ACCESS,
);
const course = await db.course.create(
	{
		discipline: LOAD.discipline,
		instructor: instructor.username,
		edition: LOAD.edition,
		description: "Load test of an exam.",
		startDate: localDateOf(new Date(now.getTime() - 30 * 86_400_000)),
		endDate: localDateOf(new Date(now.getTime() + 90 * 86_400_000)),
	},
	FULL_ACCESS,
);

for (let index = 1; index <= students; index++) {
	const username = LOAD.student(index);
	await db.user.create(
		{
			email: `${username}@load.local`,
			username,
			name: `Load Student ${index}`,
			role: "STUDENT",
			password: LOAD.password,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
	await db.enrollment.create({ course: course.id, username }, FULL_ACCESS);
}

await prisma.apiKey.create({
	data: {
		publicId: "load-bot",
		keyHash: hashToken(LOAD.botKey),
		name: "load-worker",
		kind: "BOT",
		createdById: instructor.username,
	},
});

for (const question of CODE_QUESTIONS) {
	await db.question.create(
		{
			course: course.id,
			slug: question.slug,
			status: "PUBLISHED",
			version: "v1",
			question: codeQuestionDocument(question),
		},
		FULL_ACCESS,
	);
}
for (const question of ESSAY_QUESTIONS) {
	await db.question.create(
		{
			course: course.id,
			slug: question.slug,
			status: "PUBLISHED",
			version: "v1",
			question: {
				type: "essay",
				title: question.title,
				stem: question.stem,
				content: "text",
			},
		},
		FULL_ACCESS,
	);
}

await db.exam.create(
	{
		course: course.id,
		slug: LOAD.exam,
		type: "QUIZ",
		status: "ONGOING",
		title: "Load test: Elm",
		description: "A quiz under load.",
		duration: { hours: 6 },
		allowCodeRun: true,
		tags: ["load"],
		questions: [...CODE_QUESTIONS, ...ESSAY_QUESTIONS].map(({ slug }) => ({
			slug,
			version: "v1",
		})),
	},
	FULL_ACCESS,
);

if (history > 0) await seedHistory(course.id, history);

/// Fills `Submission` with `rows` autosaves of a past exam, in closed attempts of the same students, as a database that has been through other exams holds.
async function seedHistory(courseId: CourseId, rows: number): Promise<void> {
	await db.exam.create(
		{
			course: courseId,
			slug: `${LOAD.exam}-history`,
			type: "QUIZ",
			status: "COMPLETED",
			title: "Load test: history",
			description: "A past quiz, already closed.",
			duration: { hours: 2 },
			questions: CODE_QUESTIONS.map(({ slug }) => ({ slug, version: "v1" })),
		},
		FULL_ACCESS,
	);
	const exam = await prisma.exam.findFirstOrThrow({
		where: { courseId, slug: `${LOAD.exam}-history` },
		select: { id: true },
	});
	const questions = await prisma.questionRef.findMany({
		where: { courseId, slug: { in: CODE_QUESTIONS.map(({ slug }) => slug) } },
		select: { id: true, slug: true },
	});
	const answers = new Map(
		CODE_QUESTIONS.map((question) => [
			question.slug,
			answerOf(question, "correct"),
		]),
	);
	await prisma.response.createMany({
		data: Array.from({ length: students }, (_, index) => ({
			publicId: `history-${index + 1}`,
			authorId: LOAD.student(index + 1),
			examId: exam.id,
			acceptingSubmissions: false,
		})),
	});
	const responses = await prisma.response.findMany({
		where: { examId: exam.id },
		select: { id: true },
	});
	const CHUNK = 5000;
	for (let start = 0; start < rows; start += CHUNK) {
		await prisma.submission.createMany({
			data: Array.from(
				{ length: Math.min(CHUNK, rows - start) },
				(_, i) => start + i,
			).flatMap((row) => {
				// Round-robin, so the rows of an attempt lie apart as they do when a class types at once.
				const response = responses[row % responses.length];
				const question =
					questions[Math.floor(row / responses.length) % questions.length];
				if (!response || !question) return [];
				const answer = answers.get(question.slug) || "x";
				// Sizes from 1 to twice the mean, as an answer that grows while it is typed.
				const size = 1 + ((row * 37) % Math.max(1, 2 * historyBytes));
				return [
					{
						publicId: `history-${row}`,
						kind: "AUTOSAVE" as const,
						responseId: response.id,
						questionId: question.id,
						payload: `${answer}\n`
							.repeat(Math.ceil(size / (answer.length + 1)))
							.slice(0, size),
					},
				];
			}),
		});
	}
}

console.log(
	`[load:seed] ${history} submissions of history, ${students} students, ${CODE_QUESTIONS.length} code and ${ESSAY_QUESTIONS.length} essay questions in ${LOAD.discipline}/${LOAD.courseSegment}/exams/${LOAD.exam}`,
);
await prisma.$disconnect();
