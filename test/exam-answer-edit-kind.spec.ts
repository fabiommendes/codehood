import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import type { InputKind } from "@/services/answer-edits/codec";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The edit history records why each edit happened, as the browser and
// CodeMirror announce it: typing, paste, deletion, undo and redo. The real
// exam page, the real keyboard and the real clipboard.

test.beforeEach(resetDatabase);

/// The codes of `inputKind` in the wire format.
const KINDS: readonly InputKind[] = [
	"typing",
	"paste",
	"delete",
	"undo",
	"redo",
	"composition",
	"other",
];

/// A student in an open attempt at an exam with a text essay and a code essay, with the history switch on.
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
			version: "1",
			course: course.id,
			slug: "text",
			question: {
				type: "essay",
				content: "text",
				stem: "Say something.",
				tags: [],
			},
		},
		FULL_ACCESS,
	);
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "code",
			question: {
				type: "essay",
				content: "code",
				highlight: "javascript",
				stem: "Write some code.",
				tags: [],
			},
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "kind-exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "text" }, { slug: "code" }],
	});
	await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);
	return { url: `${href}/exams/${exam.slug}` };
}

/// The kinds of the edits the page has recorded locally, oldest first.
async function recordedKinds(page: Page): Promise<InputKind[]> {
	return await page.evaluate(async (kinds) => {
		const names = (await indexedDB.databases())
			.map((entry) => entry.name ?? "")
			.filter((name) => name.includes("codehood-answer-edits"));
		const found: string[] = [];
		for (const name of names) {
			const database = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(name);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const records = await new Promise<unknown[]>((resolve, reject) => {
				const request = database
					.transaction("records")
					.objectStore("records")
					.getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			database.close();
			type Edit = { kind: string };
			for (const record of records as {
				checkpoint?: {
					state?: {
						inFlight?: { edits: unknown[][] } | null;
						queue?: { edits: Edit[] }[];
						active?: { edits: Edit[]; openEdit?: { edit: Edit } | null };
					};
				};
			}[]) {
				const state = record?.checkpoint?.state;
				for (const edit of state?.inFlight?.edits ?? [])
					found.push(String(kinds[Number(edit[5])]));
				for (const segment of state?.queue ?? [])
					for (const edit of segment.edits) found.push(edit.kind);
				for (const edit of state?.active?.edits ?? []) found.push(edit.kind);
				if (state?.active?.openEdit)
					found.push(state.active.openEdit.edit.kind);
			}
		}
		return found as InputKind[];
	}, KINDS);
}

/// Lets the monitor open its fields, so the next edits are not merged into the first.
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

const textBox = (page: Page) =>
	page.locator("textarea.mdq-textarea, textarea").first();
const codeBox = (page: Page) => page.locator(".cm-content").first();

/// Waits until the kinds recorded so far end with `kind`.
async function expectLastKind(page: Page, kind: InputKind) {
	await expect.poll(async () => (await recordedKinds(page)).at(-1)).toBe(kind);
}

test("a textarea records typing, paste, deletion, undo and redo as what they are", async ({
	page,
}) => {
	const s = await setup(page);
	await page.goto(s.url);
	const box = textBox(page);
	await expect(box).toBeVisible();
	await monitorReady(page);

	await box.click();
	await box.pressSequentially("hello", { delay: 20 });
	await expectLastKind(page, "typing");
	expect(await recordedKinds(page)).toEqual(["typing"]);

	// The real clipboard: copy what is typed, then paste it at the end.
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.press("ControlOrMeta+C");
	await page.keyboard.press("End");
	await page.keyboard.press("ControlOrMeta+V");
	await expect(box).toHaveValue("hellohello");
	await expectLastKind(page, "paste");

	await page.waitForTimeout(300);
	await page.keyboard.press("Backspace");
	await expect(box).toHaveValue("hellohell");
	await expectLastKind(page, "delete");

	await page.waitForTimeout(300);
	await page.keyboard.press("ControlOrMeta+Z");
	await expect(box).not.toHaveValue("hellohell");
	await expectLastKind(page, "undo");

	await page.waitForTimeout(300);
	await page.keyboard.press("ControlOrMeta+Shift+Z");
	await expectLastKind(page, "redo");

	const kinds = await recordedKinds(page);
	expect(kinds).toContain("paste");
	expect(kinds).toContain("delete");
	expect(kinds.filter((kind) => kind === "typing")).toHaveLength(1);
});

test("a code essay records typing and paste", async ({ page }) => {
	const s = await setup(page);
	await page.goto(s.url);
	const box = codeBox(page);
	await expect(box).toBeVisible();
	await monitorReady(page);

	await box.click();
	await box.pressSequentially("let x", { delay: 20 });
	await expectLastKind(page, "typing");
	expect(await recordedKinds(page)).toEqual(["typing"]);

	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.press("ControlOrMeta+C");
	await page.keyboard.press("End");
	await page.keyboard.press("ControlOrMeta+V");
	await expectLastKind(page, "paste");

	await page.waitForTimeout(300);
	await page.keyboard.press("Backspace");
	await expectLastKind(page, "delete");
});
