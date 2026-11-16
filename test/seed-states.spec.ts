/**
 * What the dev seed (`src/db/bootstrap.ts`) shows: one test per state the seed
 * is meant to reach, from the matrix of `dev/specs/to-do/seed-enxuto.md`.
 *
 * It reads a private copy of the seeded database `test/run.ts` prepares. Each
 * state is found by what it is (type, status, dates, submission and job
 * states, exceptions, requests), never by slug, so the seed may move a state
 * from one exam to another. The edit history lives in
 * `test/answer-edit-seed.spec.ts`. The pages read through process-wide loaders,
 * so the homes and the question statistics come from `test/seed-reports.ts`,
 * run on the same copy. "Esta semana" of the course page is a page and has no
 * test here.
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { PrismaClient } from "@/db/client";
import {
	openSeededDatabase,
	type SeededDatabase,
	seededCourses,
} from "./seed-support";

let seeded: SeededDatabase;
let prisma: PrismaClient;

test.afterAll(() => seeded.close());

const DAY_MS = 86_400_000;

/// Prisma `Json` columns come back untyped; the checks below read a few keys.
// biome-ignore lint/suspicious/noExplicitAny: the keys read below are not worth a schema.
type Json = Record<string, any>;

const examInclude = {
	course: true,
	exceptions: true,
	rubrics: { include: { items: true } },
	questionsForExams: {
		include: { questionRef: { include: { latest: true, versions: true } } },
	},
	responses: {
		include: {
			submissions: {
				include: {
					question: { include: { latest: true } },
					feedbacks: { include: { rubricItems: { include: { item: true } } } },
					regradeRequest: true,
					gradingJob: true,
				},
			},
		},
	},
} as const;

type Exam = Awaited<ReturnType<typeof loadExams>>[number];
type Response = Exam["responses"][number];
type Question = Exam["questionsForExams"][number]["questionRef"];

function loadExams() {
	return prisma.exam.findMany({
		where: { course: seededCourses },
		include: examInclude,
	});
}

let exams: Exam[];
let enrolled: { courseId: number; username: string }[];
let reports: {
	homes: Record<string, Json>;
	stats: Record<
		string,
		Record<string, { discrimination: number | null; gap: string | null }>
	>;
};

test.beforeAll(async () => {
	seeded = openSeededDatabase();
	prisma = seeded.prisma;
	exams = await loadExams();
	enrolled = await prisma.enrollment.findMany({
		where: { course: seededCourses, status: "ACTIVE" },
		select: { courseId: true, username: true },
	});
	const output = execFileSync(
		"node_modules/.bin/tsx",
		["test/seed-reports.ts"],
		{
			env: { ...process.env, DATABASE_URL: `file:${seeded.file}` },
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		},
	);
	const line = output.split("\n").find((l) => l.startsWith("SEED_REPORT "));
	if (!line) throw new Error(`no report in the output:\n${output}`);
	reports = JSON.parse(line.slice("SEED_REPORT ".length));
});

const graded = (exam: Exam) => exam.type !== "PRACTICE";
const attempts = (exam: Exam) => exam.responses.filter((r) => !r.preview);
const submissionsOf = (exam: Exam) =>
	attempts(exam).flatMap((r) => r.submissions);
const feedbacksOf = (exam: Exam) =>
	submissionsOf(exam).flatMap((s) => s.feedbacks);
const questionsOf = (exam: Exam) =>
	exam.questionsForExams.map((entry) => entry.questionRef);
const payload = (question: Pick<Question, "latest">): Json =>
	(question.latest?.privatePayload ?? {}) as Json;
const isClosed = (r: Response) => !r.acceptingSubmissions;
const windowEnd = (exam: Exam, extraMs = 0) =>
	exam.scheduledAt && exam.durationMs
		? exam.scheduledAt.getTime() + exam.durationMs + extraMs
		: null;
const isCodeEssay = (q: Pick<Question, "type" | "latest">) =>
	q.type === "ESSAY" && payload(q).content === "code";
const norm = (text: unknown) => String(text).replace(/\s+/g, "");

function expectSome<T>(items: T[]): void {
	expect(items.length).toBeGreaterThan(0);
}

test("the seeded database is there", () => {
	expectSome(exams);
});

// Calendar of the exams

test("a dated draft exam holds a draft question", () => {
	expectSome(
		exams.filter(
			(exam) =>
				exam.status === "DRAFT" &&
				exam.scheduledAt &&
				questionsOf(exam).some((q) => q.status === "DRAFT"),
		),
	);
});

test("a scheduled exam still to come has extra time", () => {
	const now = Date.now();
	expectSome(
		exams.filter(
			(exam) =>
				exam.status === "SCHEDULED" &&
				exam.extraTimeMs > 0 &&
				(exam.scheduledAt?.getTime() ?? 0) > now,
		),
	);
});

test("an open exam the dev student has not started", () => {
	const open = reports.homes.student?.openNow as { started: boolean }[];
	expectSome(open.filter((entry) => !entry.started));
});

test("an open exam has an attempt in progress", () => {
	expectSome(
		exams.filter(
			(exam) =>
				graded(exam) &&
				exam.status === "ONGOING" &&
				attempts(exam).some((r) => !isClosed(r) && r.submissions.length > 0),
		),
	);
});

test("an open exam has an expired attempt nobody delivered", () => {
	const now = Date.now();
	expectSome(
		exams.filter(
			(exam) =>
				graded(exam) &&
				exam.status === "ONGOING" &&
				exam.durationMs &&
				attempts(exam).some(
					(r) =>
						!isClosed(r) &&
						r.submissions.length > 0 &&
						r.createdAt.getTime() + (exam.durationMs ?? 0) < now,
				),
		),
	);
});

test("an exam has delivered attempts waiting for correction", () => {
	expectSome(
		exams.filter(
			(exam) =>
				graded(exam) &&
				exam.gradesReleasedAt === null &&
				attempts(exam).some(
					(r) =>
						isClosed(r) &&
						r.submissions.some(
							(s) =>
								s.status === "PENDING_GRADE" &&
								s.feedbacks.length === 0 &&
								!s.gradingJob,
						),
				),
		),
	);
});

test("a student missed an exam that is over", () => {
	const now = Date.now();
	expectSome(
		exams.filter(
			(exam) =>
				exam.type === "EXAM" &&
				(exam.status === "COMPLETED" || (windowEnd(exam) ?? Infinity) < now) &&
				enrolled.some(
					({ courseId, username }) =>
						courseId === exam.courseId &&
						!exam.responses.some((r) => r.authorId === username) &&
						!exam.exceptions.some((x) => x.username === username),
				),
		),
	);
});

test("an exam is ready to release for an instructor", () => {
	const ready = Object.values(reports.homes).flatMap(
		(home) => home.toRelease as unknown[],
	);
	expectSome(ready);
});

test("grades released less than a week ago", () => {
	const now = Date.now();
	expectSome(
		exams.filter(
			(exam) =>
				exam.type === "EXAM" &&
				exam.gradesReleasedAt &&
				exam.gradesReleasedAt.getTime() > now - 7 * DAY_MS &&
				exam.gradesReleasedAt.getTime() <= now + 60_000,
		),
	);
});

test("a quiz released its grades by closing", () => {
	expectSome(
		exams.filter(
			(exam) =>
				exam.type === "QUIZ" &&
				exam.status === "COMPLETED" &&
				exam.gradesReleasedAt === null &&
				attempts(exam).length > 0 &&
				feedbacksOf(exam).length > 0,
		),
	);
});

test("a practice exam", () => {
	expectSome(exams.filter((exam) => exam.type === "PRACTICE"));
});

// Questions and attachments

test("an open quiz holds one question of each basic type", () => {
	const wanted = [
		"MULTIPLE_CHOICE",
		"TRUE_FALSE",
		"NUMERIC",
		"SHORT_ANSWER",
		"FILL_IN",
		"ORDERING",
		"ESSAY",
	];
	expectSome(
		exams.filter((exam) => {
			const types = new Set<string>(questionsOf(exam).map((q) => q.type));
			return (
				exam.type === "QUIZ" &&
				exam.status === "ONGOING" &&
				wanted.every((type) => types.has(type))
			);
		}),
	);
});

test("running code is on by default in practice, off in a quiz and on by choice in an exam", () => {
	const withCode = (exam: Exam) => questionsOf(exam).some(isCodeEssay);
	expectSome(
		exams.filter(
			(exam) =>
				exam.type === "PRACTICE" &&
				exam.allowCodeRun === null &&
				withCode(exam),
		),
	);
	expectSome(
		exams.filter(
			(exam) =>
				exam.type === "QUIZ" &&
				exam.status === "ONGOING" &&
				exam.allowCodeRun === null &&
				withCode(exam),
		),
	);
	expectSome(
		exams.filter(
			(exam) =>
				exam.type === "EXAM" && exam.allowCodeRun === true && withCode(exam),
		),
	);
});

test("an exam has attachments of its own and on its questions", async () => {
	const owners = await prisma.attachment.findMany({
		where: { attachedToType: { in: ["EXAM", "QUESTION"] } },
	});
	expectSome(
		exams.filter(
			(exam) =>
				owners.some(
					(a) => a.attachedToType === "EXAM" && a.attachedToId === exam.id,
				) &&
				questionsOf(exam).some((q) =>
					owners.some(
						(a) => a.attachedToType === "QUESTION" && a.attachedToId === q.id,
					),
				),
		),
	);
});

test("an exam still to open carries an attachment", async () => {
	const owners = await prisma.attachment.findMany({
		where: { attachedToType: "EXAM" },
	});
	expectSome(
		exams.filter(
			(exam) =>
				exam.status === "SCHEDULED" &&
				owners.some((a) => a.attachedToId === exam.id),
		),
	);
});

test("a question has two versions with a different attached file", async () => {
	const refs = await prisma.questionRef.findMany({
		where: { course: seededCourses },
		include: { versions: true },
	});
	expectSome(
		refs.filter((ref) => {
			const files = ref.versions.map((v) => JSON.stringify(v.files));
			return files.length >= 2 && new Set(files).size === files.length;
		}),
	);
});

test("Elm questions are pretested by an examples block and by test modules", () => {
	const code = exams.flatMap((exam) =>
		questionsOf(exam).filter((q) => q.type === "CODE"),
	);
	const text = (q: Question) => JSON.stringify(payload(q));
	expectSome(code.filter((q) => text(q).includes("{example}")));
	expectSome(code.filter((q) => text(q).includes("module XPublic")));
});

// External grading

test("an exam shows every state of the external grading queue", () => {
	expectSome(
		exams.filter((exam) => {
			if (!graded(exam)) return false;
			const subs = submissionsOf(exam);
			const states = new Set(subs.map((s) => s.gradingJob?.state));
			const scores = subs
				.filter((s) => s.gradingJob?.state === "DONE")
				.flatMap((s) => s.feedbacks.map((f) => Number(f.score)));
			return (
				["QUEUED", "CLAIMED", "DONE", "FAILED", "CANCELLED"].every((state) =>
					states.has(state as never),
				) &&
				subs.some((s) => s.status === "PRETEST_FAILED") &&
				scores.some((score) => score > 0 && score < 1) &&
				scores.some((score) => score === 1) &&
				attempts(exam).some((r) => {
					const sent = r.submissions.filter((s) => s.kind === "SUBMIT");
					const limit = sent[0]?.question.attempts;
					return limit != null && sent.length >= limit;
				}) &&
				attempts(exam).some(
					(r) =>
						r.submissions.length > 0 &&
						r.submissions.every((s) => s.kind === "AUTOSAVE"),
				)
			);
		}),
	);
});

test("a practice exam holds repeated sends of the same question", () => {
	expectSome(
		exams.filter(
			(exam) =>
				exam.type === "PRACTICE" &&
				exam.responses.some((r) => {
					const sent = r.submissions.filter((s) => s.kind === "SUBMIT");
					return (
						sent.length >= 2 &&
						new Set(sent.map((s) => s.questionId)).size < sent.length
					);
				}),
		),
	);
});

test("a closed attempt holds a send the bot corrected", () => {
	expectSome(
		exams.flatMap((exam) =>
			exam.responses.filter(
				(r) =>
					isClosed(r) &&
					r.submissions.some(
						(s) =>
							s.kind === "SUBMIT" &&
							s.status === "GRADED_AUTOMATICALLY" &&
							s.gradingJob?.state === "DONE",
					),
			),
		),
	);
});

test("an instructor's simulation is under way with a send in the queue", () => {
	expectSome(
		exams.flatMap((exam) =>
			exam.responses.filter(
				(r) =>
					r.preview &&
					!isClosed(r) &&
					r.submissions.some((s) => s.gradingJob?.state === "QUEUED"),
			),
		),
	);
});

test("an instructor's simulation was delivered", () => {
	expectSome(
		exams.flatMap((exam) =>
			exam.responses.filter(
				(r) => r.preview && isClosed(r) && r.submissions.length > 0,
			),
		),
	);
});

// Correction

test("an exam holds automatic, manual, pending and will-not-grade answers, and a blank one", () => {
	expectSome(
		exams.filter((exam) => {
			if (!graded(exam)) return false;
			const statuses = new Set(submissionsOf(exam).map((s) => s.status));
			const total = exam.questionsForExams.length;
			return (
				statuses.has("GRADED_AUTOMATICALLY") &&
				statuses.has("GRADED_MANUALLY") &&
				statuses.has("PENDING_GRADE") &&
				statuses.has("WILL_NOT_GRADE") &&
				attempts(exam).some(
					(r) =>
						isClosed(r) &&
						r.submissions.length > 0 &&
						new Set(r.submissions.map((s) => s.questionId)).size < total,
				)
			);
		}),
	);
});

test("a manual grade carries a comment", () => {
	expectSome(
		exams.flatMap((exam) =>
			submissionsOf(exam).filter(
				(s) =>
					s.status === "GRADED_MANUALLY" &&
					s.feedbacks.some((f) => f.graderId && f.feedback && !f.rubricId),
			),
		),
	);
});

test("a fill-in blank and an ordering wait for the instructor", () => {
	const pending = (type: string) =>
		exams.flatMap((exam) =>
			submissionsOf(exam).filter(
				(s) =>
					s.question.type === type &&
					s.status === "PENDING_GRADE" &&
					s.feedbacks.length === 0 &&
					!s.gradingJob,
			),
		);
	expectSome(pending("FILL_IN"));
	expectSome(pending("ORDERING"));
});

test("a blank was graded on its own", () => {
	expectSome(
		exams.flatMap((exam) =>
			feedbacksOf(exam).filter((f) => f.blanks !== null && f.graderId),
		),
	);
});

test("the bot graded with notes for the instructor", () => {
	expectSome(
		exams.flatMap((exam) =>
			feedbacksOf(exam).filter((f) => f.botId && f.notes),
		),
	);
});

test("an exam has JavaScript, Python and Prolog code to run at correction", () => {
	const languages = (exam: Exam) =>
		new Set(
			submissionsOf(exam)
				.filter((s) => isCodeEssay(s.question))
				.map((s) => payload(s.question).highlight),
		);
	expectSome(
		exams.filter((exam) => {
			const found = languages(exam);
			return ["javascript", "python", "prolog"].every((lang) =>
				found.has(lang),
			);
		}),
	);
});

// Rubrics

test("a question has an initial rubric that the exam did not copy", () => {
	expectSome(
		exams.filter((exam) =>
			questionsOf(exam).some(
				(q) =>
					payload(q).rubric &&
					!exam.rubrics.some((rubric) => rubric.questionRefId === q.id),
			),
		),
	);
});

test("a rubric in use has groups, a negative item and a split item", () => {
	expectSome(
		exams.flatMap((exam) =>
			exam.rubrics.filter(
				(rubric) =>
					feedbacksOf(exam).some((f) => f.rubricId === rubric.id) &&
					rubric.items.some((i) => i.group) &&
					rubric.items.some((i) => Number(i.value) < 0) &&
					rubric.items.some((i) => i.retiredAt),
			),
		),
	);
});

test("rubric passes: items, an adjustment, one to review and the bot's", () => {
	const passes = exams.flatMap((exam) =>
		feedbacksOf(exam).filter((f) => f.rubricId),
	);
	expectSome(passes.filter((f) => f.rubricItems.length > 0));
	expectSome(passes.filter((f) => f.adjustment));
	expectSome(passes.filter((f) => f.rubricItems.some((x) => x.item.retiredAt)));
	expectSome(passes.filter((f) => f.botId));
});

test("pending answers that are equal up to spaces, and one that differs", () => {
	expectSome(
		exams.filter((exam) => {
			const pending = submissionsOf(exam).filter(
				(s) => s.status === "PENDING_GRADE" && s.question.type === "ESSAY",
			);
			return pending.some((s) =>
				pending.some(
					(other) =>
						other.questionId === s.questionId &&
						other.id !== s.id &&
						norm(other.payload) === norm(s.payload) &&
						pending.some(
							(third) =>
								third.questionId === s.questionId &&
								norm(third.payload) !== norm(s.payload),
						),
				),
			);
		}),
	);
});

test("a released exam shows the student its rubric", () => {
	expectSome(
		exams.filter(
			(exam) =>
				exam.gradesReleasedAt &&
				feedbacksOf(exam).some((f) => f.rubricId && f.rubricItems.length > 0),
		),
	);
});

// Exceptions

test("an exception gives extra time on an exam still to come", () => {
	const now = Date.now();
	expectSome(
		exams.filter(
			(exam) =>
				exam.status === "SCHEDULED" &&
				(exam.scheduledAt?.getTime() ?? 0) > now &&
				exam.exceptions.some((x) => x.extraTimeMs > 0),
		),
	);
});

test("a makeup exam blocks the release of the grades", () => {
	expectSome(
		exams.filter(
			(exam) =>
				graded(exam) &&
				exam.gradesReleasedAt === null &&
				exam.exceptions.some(
					(x) =>
						x.scheduledAt &&
						!exam.responses.some((r) => r.authorId === x.username),
				),
		),
	);
});

test("an exception keeps a student's window open after the exam's own ended", () => {
	const now = Date.now();
	expectSome(
		exams.filter((exam) =>
			exam.exceptions.some((x) => {
				const end = windowEnd(exam);
				const personal = windowEnd(exam, x.extraTimeMs);
				return (
					graded(exam) &&
					x.extraTimeMs > 0 &&
					end !== null &&
					personal !== null &&
					end <= now &&
					personal > now &&
					exam.responses.some((r) => r.authorId === x.username && isClosed(r))
				);
			}),
		),
	);
});

// Statistics, weights and reviews

test("question statistics show a negative discrimination and a question without variance", () => {
	const entries = Object.values(reports.stats).flatMap((byQuestion) =>
		Object.entries(byQuestion),
	);
	expectSome(
		entries.filter(
			([, s]) => s.discrimination !== null && s.discrimination < 0,
		),
	);
	expectSome(entries.filter(([, s]) => s.gap === "no-variance"));
});

test("a multiple-choice question has a popular distractor and an option nobody chose", () => {
	const tally = (exam: Exam, question: Question) => {
		const choices = (payload(question).choices ?? []) as {
			id: string;
			score?: number;
		}[];
		const picks = submissionsOf(exam)
			.filter((s) => s.questionId === question.id)
			.map((s) => s.payload);
		return choices.map((choice) => ({
			wrong: !choice.score,
			count: picks.filter((pick) => pick === choice.id).length,
		}));
	};
	const rows = exams.filter(graded).flatMap((exam) =>
		questionsOf(exam)
			.filter((q) => q.type === "MULTIPLE_CHOICE")
			.map((q) => tally(exam, q)),
	);
	expectSome(rows.filter((r) => r.some((c) => c.wrong && c.count >= 3)));
	expectSome(
		rows.filter(
			(r) => r.some((c) => c.count === 0) && r.some((c) => c.count > 0),
		),
	);
});

test("an exam weighs its questions 3, 2 and 1", () => {
	expectSome(
		exams.filter((exam) => {
			const weights = new Set(questionsOf(exam).map((q) => payload(q).weight));
			return (
				[3, 2, 1].every((w) => weights.has(w)) && attempts(exam).length > 0
			);
		}),
	);
});

test("an exam has an open, an accepted and a rejected review, and an answer without one", () => {
	expectSome(
		exams.filter((exam) => {
			const requests = submissionsOf(exam).flatMap((s) =>
				s.regradeRequest ? [s.regradeRequest.status] : [],
			);
			return (
				["OPEN", "ACCEPTED", "REJECTED"].every((status) =>
					requests.includes(status as never),
				) &&
				submissionsOf(exam).some(
					(s) => !s.regradeRequest && s.feedbacks.length > 0,
				)
			);
		}),
	);
});

// Homes

test("the dev student's home: open exams, today's events, results and reviews", () => {
	const home = reports.homes.student as Json;
	expectSome(home.openNow);
	expectSome(home.today);
	expectSome(home.results);
	expectSome(home.regrades);
});

test("the dev student's home announces an exam that opens soon", () => {
	expectSome(reports.homes.student?.upcoming);
});

test("ada's home: exams in progress and to grade, reviews, reports and today's meeting", () => {
	const home = reports.homes.ada as Json;
	expectSome(home.inProgress);
	expectSome(home.toGrade);
	expectSome(home.regrades);
	expectSome(home.reports);
	expectSome(home.today);
});

test("the dev instructor's home is empty", () => {
	const home = reports.homes.instructor as Json;
	for (const key of [
		"inProgress",
		"toGrade",
		"toRelease",
		"problems",
		"reports",
		"today",
	]) {
		expect(home[key], key).toEqual([]);
	}
});
