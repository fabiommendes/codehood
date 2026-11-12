/**
 * What the dev seed (`src/db/bootstrap.ts`) holds for the edit history (spec
 * `dev/specs/to-review/historico-de-edicao-no-servidor.md`, R36). It reads the
 * seeded database `test/run.ts` prepares, from a private copy of it (see
 * `beforeAll`), and looks only at the courses of the seeded instructors.
 *
 * The spec names no slugs, so each situation is found by what it is, not by
 * where it lives.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { PrismaClient } from "@/db/client";
import { TEST_SEEDED_DB_PATH } from "./env";

/// A copy of the seeded database `test/run.ts` prepares, which no worker writes to.
/// The worker's own database is shared with the spec files that run before and
/// after this one, and some of them empty it; the seed is read from here instead.
let prisma: PrismaClient;
let scratch: string;

test.beforeAll(() => {
	scratch = mkdtempSync(path.join(tmpdir(), "codehood-seed-"));
	const file = path.join(scratch, "seeded.db");
	copyFileSync(TEST_SEEDED_DB_PATH, file);
	prisma = new PrismaClient({
		adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
	});
});

test.afterAll(async () => {
	await prisma.$disconnect();
	rmSync(scratch, { recursive: true, force: true });
});

const SEEDED_INSTRUCTORS = ["ada", "alan", "instructor"];

const seededCourses = { instructorId: { in: SEEDED_INSTRUCTORS } };

/// Every attempt of the seeded courses that has a history, with its exam.
function seededHistories() {
	return prisma.answerEditHistory.findMany({
		where: { response: { exam: { course: seededCourses } } },
		include: {
			response: { include: { exam: { include: { course: true } } } },
			fields: { include: { batches: true, gaps: true } },
		},
	});
}

/// The summary the instructor reads of one seeded history.
async function summaryOfHistory(
	history: Awaited<ReturnType<typeof seededHistories>>[number],
) {
	const { exam } = history.response;
	const summary = await db.answerEdit.summary(
		{
			course: exam.course.id,
			exam: exam.slug,
			author: history.response.authorId,
		},
		{ ...FULL_ACCESS, tx: prisma },
	);
	return { history, exam, summary };
}

async function allSummaries() {
	return Promise.all((await seededHistories()).map(summaryOfHistory));
}

test("the seeded database is there", async () => {
	const courses = await prisma.course.count({ where: seededCourses });
	expect(courses).toBeGreaterThan(0);
});

test("R36: some attempt has a normal history with a paste and a large insertion", async () => {
	const found = (await allSummaries()).filter(
		({ exam, summary }) =>
			exam.answerHistory !== false &&
			summary.enabled &&
			summary.questions.some(
				({ summary: s }) =>
					s.state === "complete" &&
					s.pastes.count > 0 &&
					s.largeInsertions.length > 0,
			),
	);
	expect(found.length).toBeGreaterThan(0);
});

test("R36: the exam with histories follows at least two essay questions (text and code)", async () => {
	const exams = (await allSummaries()).filter(({ summary }) =>
		summary.questions.some(({ summary: s }) => s.state !== "none"),
	);
	expect(exams.length).toBeGreaterThan(0);
	expect(exams.some(({ summary }) => summary.questions.length >= 2)).toBe(true);
});

test("R36: some attempt has a gap by rebase", async () => {
	const found = (await allSummaries()).filter(({ summary }) =>
		summary.questions.some(({ summary: s }) =>
			s.gaps.some((gap) => gap.type === "rebase"),
		),
	);
	expect(found.length).toBeGreaterThan(0);
});

test("R36: some attempt has a gap by marker", async () => {
	const found = (await allSummaries()).filter(({ summary }) =>
		summary.questions.some(({ summary: s }) =>
			s.gaps.some((gap) => gap.type === "marker"),
		),
	);
	expect(found.length).toBeGreaterThan(0);
});

test("R36: some attempt has an incomplete history", async () => {
	const found = (await allSummaries()).filter(({ summary }) =>
		summary.questions.some(({ summary: s }) => s.state === "incomplete"),
	);
	expect(found.length).toBeGreaterThan(0);
});

test("R36: an exam switched off keeps the history recorded before", async () => {
	const found = (await allSummaries()).filter(
		({ exam, summary }) =>
			exam.answerHistory === false &&
			summary.enabled === false &&
			summary.questions.some(
				({ summary: s }) => s.firstAt !== null && s.activeMs > 0,
			),
	);
	expect(found.length).toBeGreaterThan(0);
});

test("R36: a practice exam on the default has an attempt without history", async () => {
	const attempts = await prisma.response.findMany({
		where: {
			exam: { type: "PRACTICE", answerHistory: null, course: seededCourses },
		},
		include: { editHistory: true },
	});
	expect(attempts.length).toBeGreaterThan(0);
	expect(attempts.every((attempt) => attempt.editHistory === null)).toBe(true);
});

test("R36: the batches went through the service, so the totals add up", async () => {
	const histories = await seededHistories();
	expect(histories.length).toBeGreaterThan(0);
	for (const history of histories) {
		const batches = history.fields.flatMap((field) => field.batches);
		const sum = (pick: (batch: (typeof batches)[number]) => number) =>
			batches.reduce((total, batch) => total + pick(batch), 0);
		expect(history.editCount).toBe(sum((b) => b.editCount));
		expect(history.byteCount).toBe(sum((b) => b.byteCount));
		for (const field of history.fields) {
			expect(field.revision).toBe(field.batches.length);
			expect(field.nextSeq).toBe(
				field.batches.reduce((total, batch) => total + batch.editCount, 0),
			);
		}
	}
});
