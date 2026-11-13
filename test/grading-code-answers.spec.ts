import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { examResult, resultPolicy } from "@/services/exam-result";
import type { ExamTiming } from "@/services/exam-state";
import {
	type CountingAnswer,
	countingAnswers,
	type GradingAttempt,
	type GradingFeedback,
} from "@/services/grading";
import { loadExamGrading } from "@/utils/load-grading";

// The counting answer of a `code` question agrees with `examResult`: same
// verdict and state, and the answer is the send that counts.

const MINUTE = 60_000;
const T0 = new Date("2026-03-10T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * MINUTE);
const NOW = at(10_000);

const exam: ExamTiming = {
	type: "EXAM",
	status: "ONGOING",
	scheduledAt: null,
	duration: null,
	extraTime: null,
};

type Row = GradingAttempt["submissions"][number];
type Kind = Row["kind"];

function send(
	publicId: string,
	minutes: number,
	overrides: Partial<Row> = {},
	id = 1,
): Row {
	return {
		id: id as Row["id"],
		publicId,
		responseId: 1 as Row["responseId"],
		questionId: 1 as Row["questionId"],
		response: "response-1",
		question: "q",
		status: "PENDING_GRADE",
		kind: "SUBMIT",
		automaticallyTriggered: false,
		payload: { answer: publicId },
		startedAt: null,
		createdAt: at(minutes),
		...overrides,
	} as Row;
}

function pass(
	submission: string,
	score: string,
	minutes: number,
	overrides: Partial<GradingFeedback> = {},
): GradingFeedback {
	return {
		submission,
		score,
		feedback: null,
		grader: null,
		bot: "runner",
		updatedAt: at(minutes),
		...overrides,
	} as GradingFeedback;
}

function answerOf(
	submissions: Row[],
	feedback: GradingFeedback[],
	practice = false,
): CountingAnswer {
	const attempt: GradingAttempt = {
		author: "ana",
		createdAt: at(-60),
		acceptingSubmissions: false,
		submissions,
	};
	const answers = countingAnswers(
		exam,
		["q"],
		[attempt],
		feedback,
		NOW,
		new Map(),
		resultPolicy(practice ? "PRACTICE" : "EXAM", {}),
	);
	expect(answers).toHaveLength(1);
	return answers[0] as CountingAnswer;
}

test("a better earlier send is discounted by the later one: 0.667 then 1 is 0.8", () => {
	const answer = answerOf(
		[send("a", 1, {}, 1), send("b", 2, {}, 2)],
		[pass("a", "0.667", 1), pass("b", "1", 2)],
	);
	expect(answer.state).toBe("graded");
	expect(answer.verdict).toBeCloseTo(0.8);
	expect(answer.submission).toBe("b");
	expect(answer.codeAttempts?.map((a) => a.counts)).toEqual([false, true]);
});

test("1 then 0.5: the first send counts", () => {
	const answer = answerOf(
		[send("a", 1, {}, 1), send("b", 2, {}, 2)],
		[pass("a", "1", 1), pass("b", "0.5", 2)],
	);
	expect(answer.state).toBe("graded");
	expect(answer.verdict).toBe(1);
	expect(answer.submission).toBe("a");
	expect(answer.createdAt).toEqual(at(1));
	expect(answer.passes.map((p) => p.score)).toEqual([1]);
});

test("a graded send followed by one still queued is pending", () => {
	const answer = answerOf(
		[send("a", 1, {}, 1), send("b", 2, {}, 2)],
		[pass("a", "1", 1)],
	);
	expect(answer.state).toBe("pending");
	expect(answer.verdict).toBeNull();
	expect(answer.submission).toBe("b");
});

test("sends that only failed the pretest are graded 0", () => {
	const answer = answerOf(
		[
			send("a", 1, { status: "PRETEST_FAILED" as Row["status"] }, 1),
			send("b", 2, { status: "PRETEST_FAILED" as Row["status"] }, 2),
		],
		[],
	);
	const [outcome] = examResult(
		["q"],
		[
			send("a", 1, { status: "PRETEST_FAILED" as Row["status"] }, 1),
			send("b", 2, { status: "PRETEST_FAILED" as Row["status"] }, 2),
		],
		[],
	).questions;
	expect(answer.state).toBe(outcome?.status);
	expect(answer.verdict).toBe(outcome?.score);
	expect(answer.verdict).toBe(0);
});

test("a send that failed the pretest after a graded one does not take over", () => {
	const answer = answerOf(
		[
			send("a", 1, {}, 1),
			send("b", 2, { status: "PRETEST_FAILED" as Row["status"] }, 2),
		],
		[pass("a", "0.5", 1)],
	);
	expect(answer.state).toBe("graded");
	expect(answer.verdict).toBe(0.5);
	expect(answer.submission).toBe("a");
});

test("an autosave newer than the last send is not the answer", () => {
	const answer = answerOf(
		[send("a", 1, {}, 1), send("draft", 5, { kind: "AUTOSAVE" }, 2)],
		[pass("a", "0.6", 1), pass("draft", "1", 5)],
	);
	expect(answer.submission).toBe("a");
	expect(answer.verdict).toBe(0.6);
});

test("in a practice exam there is no discount: 0.667 then 1 is 1", () => {
	const answer = answerOf(
		[send("a", 1, {}, 1), send("b", 2, {}, 2)],
		[pass("a", "0.667", 1), pass("b", "1", 2)],
		true,
	);
	expect(answer.verdict).toBe(1);
	expect(answer.submission).toBe("b");
});

test("a human pass newer than the bot's replaces its score on that send", () => {
	const answer = answerOf(
		[send("a", 1, {}, 1)],
		[
			pass("a", "0.5", 1),
			pass("a", "0.9", 3, { grader: "teacher", bot: null }),
		],
	);
	expect(answer.verdict).toBe(0.9);
	expect(answer.passes[0]?.grader).toBe("teacher");
});

test("a question of another kind and a code question with only autosaves keep the newest-submission rule", () => {
	const answer = answerOf(
		[
			send("a", 1, { kind: "AUTOSAVE" }, 1),
			send("b", 2, { kind: "AUTOSAVE" }, 2),
		],
		[pass("a", "1", 1), pass("b", "0.4", 2)],
	);
	expect(answer.submission).toBe("b");
	expect(answer.verdict).toBe(0.4);
	expect(answer.state).toBe("graded");
	expect(answer.codeAttempts).toBeUndefined();

	const waiting = answerOf([send("a", 1, { kind: "AUTOSAVE" }, 1)], []);
	expect(waiting.state).toBe("pending");
	expect(waiting.verdict).toBeNull();
});

test("property: verdict and state agree with examResult", () => {
	const kinds = fc.constantFrom<Kind>("AUTOSAVE", "SUBMIT", "FINAL");
	const statuses = fc.constantFrom(
		"PENDING_GRADE",
		"WILL_NOT_GRADE",
		"PRETEST_FAILED",
	);
	const scores = fc.constantFrom("0", "0.25", "0.667", "1");
	const submission = fc.record({
		kind: kinds,
		status: statuses,
		score: fc.option(scores, { nil: null }),
		extra: fc.option(scores, { nil: null }),
	});
	fc.assert(
		fc.property(
			fc.array(submission, { minLength: 1, maxLength: 6 }),
			fc.boolean(),
			(items, practice) => {
				const rows = items.map((item, index) =>
					send(
						`s${index}`,
						index,
						{ kind: item.kind, status: item.status as Row["status"] },
						index + 1,
					),
				);
				const feedback = items.flatMap((item, index) => [
					...(item.score ? [pass(`s${index}`, item.score, index)] : []),
					...(item.extra
						? [pass(`s${index}`, item.extra, index + 20, { bot: null })]
						: []),
				]);
				const policy = resultPolicy(practice ? "PRACTICE" : "EXAM", {});
				const [expected] = examResult(["q"], rows, feedback, policy).questions;
				const answer = answerOf(rows, feedback, practice);
				expect(answer.state).toBe(expected?.status);
				expect(answer.verdict).toBe(expected?.score);
				const sent = items.some((i) => i.kind !== "AUTOSAVE");
				if (sent && expected?.status === "graded") {
					expect(answer.submission).toBe(expected.submission);
				}
				if (sent) {
					const chosen = rows.find((r) => r.publicId === answer.submission);
					expect(chosen?.kind).not.toBe("AUTOSAVE");
				}
			},
		),
		{ numRuns: 300 },
	);
});

//
// The loader the grading screen reads, on the seeded database.
//

test("loadExamGrading: seeded `test-elm` answers agree with examResult", async () => {
	const course = await seededCourse();
	for (const username of ["hopper", "thompson"]) {
		const student = await db.user.findOne({ username }, FULL_ACCESS);
		await db.response.finish(
			{ course: course.id, exam: "test-elm" },
			{ actor: student as NonNullable<typeof student> },
		);
	}
	const ada = await db.user.findOne({ username: "ada" }, FULL_ACCESS);
	const loaded = await loadExamGrading(
		course.id,
		"test-elm",
		ada as NonNullable<typeof ada>,
	);
	expect(loaded).not.toBeNull();
	const { answers, attempts, feedback } = loaded as NonNullable<typeof loaded>;
	const policy = resultPolicy("EXAM", {});
	const seen = new Map<string, CountingAnswer>();
	for (const answer of answers) {
		if (answer.question === "elm-soma") seen.set(answer.author, answer);
	}

	for (const author of ["hopper", "thompson"]) {
		const attempt = attempts.find((a) => a.author === author);
		const answer = seen.get(author);
		expect(attempt, author).toBeDefined();
		expect(answer, author).toBeDefined();
		const [expected] = examResult(
			["elm-soma"],
			(attempt as NonNullable<typeof attempt>).submissions,
			feedback,
			policy,
		).questions;
		expect(answer?.state, author).toBe(expected?.status);
		expect(answer?.verdict, author).toBe(expected?.score);
		expect(answer?.submission, author).toBe(
			expected?.status === "graded" ? expected.submission : answer?.submission,
		);
	}
	expect(seen.get("hopper")?.state).toBe("graded");
	expect(seen.get("hopper")?.verdict).toBeCloseTo(0.8);
});

/// The seeded course that holds the `test-elm` exam.
async function seededCourse() {
	const courses = await db.course.findMany({}, FULL_ACCESS);
	for (const course of courses) {
		const found = await db.exam.findOne(
			{ course: course.id, slug: "test-elm" },
			FULL_ACCESS,
		);
		if (found) return course;
	}
	throw new Error("the seeded database has no `test-elm` exam");
}
