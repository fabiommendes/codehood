import { firstFencedCode } from "mdq";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { sumCode } from "@/mdq/fixtures";
import { decodeEdits } from "@/services/answer-edits/codec";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The edit history follows MDQ `code` questions on the real exam page: the
// editor starts from the template, and what the student types and pastes
// reaches the server with its cause.

test.beforeEach(resetDatabase);

const POLL = { timeout: 20_000, intervals: [250, 500, 1000] };
/// The code the editor starts with, as the page takes it from the question.
const TEMPLATE = firstFencedCode(sumCode.template ?? "") ?? "";

/// A student in an open attempt at an exam with one code question, on the default switch, which records.
async function setup(page: Page) {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "v1",
			course: course.id,
			slug: "sum",
			question: sumCode,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "code-history",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "sum" }],
	});
	const attempt = await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);
	return { url: `${href}/exams/${exam.slug}`, attempt: attempt.publicId };
}

/// Lets the monitor open its field, so the first edits are recorded.
async function monitorReady(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(async () =>
				(await indexedDB.databases()).some((entry) =>
					entry.name?.includes("codehood-answer-edits"),
				),
			),
		)
		.toBe(true);
	await page.waitForTimeout(300);
}

/// Hides the page and shows it again: the page flushes its history when it is hidden.
async function flushHistory(page: Page): Promise<void> {
	await page.evaluate(() => {
		const state = (value: DocumentVisibilityState) =>
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => value,
			});
		state("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		state("visible");
	});
}

/// The history the server holds for the answer of the code question.
async function storedCodeField(attempt: string) {
	return prisma.answerEditField.findFirst({
		where: {
			field: "answer",
			question: { slug: "sum" },
			history: { response: { publicId: attempt } },
		},
		include: { batches: { orderBy: { revision: "asc" } } },
	});
}

test("a code question sends its typing and paste to the server, starting from the template", async ({
	page,
}) => {
	const s = await setup(page);
	await page.goto(s.url);
	const editor = page.locator(".cm-content").first();
	await expect(editor).toContainText("def add(a, b):");
	await monitorReady(page);

	await editor.click();
	await page.keyboard.press("ControlOrMeta+End");
	await editor.pressSequentially(" # ok", { delay: 20 });
	await page.waitForTimeout(300);
	// The real clipboard: copy the whole code and paste it at the end.
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.press("ControlOrMeta+C");
	await page.keyboard.press("ControlOrMeta+End");
	await page.keyboard.press("ControlOrMeta+V");
	const typed = `${TEMPLATE} # ok`;
	const expected = `${typed}${typed}`;

	await expect
		.poll(async () => {
			await flushHistory(page);
			return (await storedCodeField(s.attempt))?.text ?? null;
		}, POLL)
		.toBe(expected);

	const batches = (await storedCodeField(s.attempt))?.batches ?? [];
	expect(batches[0]?.baseReason).toBe("start");
	expect(batches[0]?.baseText).toBe(TEMPLATE);
	const edits = batches.flatMap((batch) =>
		decodeEdits({
			version: batch.version,
			timeOriginMs: batch.timeOriginMs,
			edits: batch.edits,
		}),
	);
	const kinds = edits.map((edit) => edit.kind);
	expect(kinds[0]).toBe("typing");
	expect(kinds).toContain("paste");
	expect(edits.find((edit) => edit.kind === "paste")?.insertedText).toBe(typed);
	// The template is where the history starts, never an edit the student typed.
	expect(
		edits.filter((edit) => edit.kind === "typing").map((e) => e.insertedText),
	).not.toContainEqual(expect.stringContaining("def add"));
});
