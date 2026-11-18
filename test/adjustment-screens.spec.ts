import { InvalidData } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { expect, type Page, test } from "./fixtures";
import {
	type AdjustableExam,
	adjust,
	adjustableExam,
} from "./stories/adjustment-support";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The instructor's screens for the adjustments of one exam, one rule per test. Ana is at 50%, Bia at 75%
// and Davi at 100%. The tables are in `adjustment-tables.spec.ts`, the whole walk in the story.

test.beforeEach(resetDatabase);

/// The exam, with its grades released, and the instructor signed in.
async function world(page: Page, prefix: string): Promise<AdjustableExam> {
	const exam = await adjustableExam(prefix);
	await prisma.exam.update({
		where: { id: exam.exam.id },
		data: { gradesReleasedAt: new Date(Date.now() - 60_000) },
	});
	await logInAs(page, exam.teacher);
	return exam;
}

/// The "Grade adjustments" summary of the attempt on display.
const summary = (page: Page) =>
	page.getByRole("region", { name: "Grade adjustments" });

/// The adjustments the exam has, active ones only.
const activeCount = async (w: AdjustableExam) =>
	(
		await db.examAdjustment.findMany(
			{ course: w.course.id, exam: w.exam.slug },
			{ actor: w.teacher },
		)
	).length;

/// Adds a bonus of `kind` to the attempt on display, through the dialog, and returns the dialog.
async function addBonus(
	page: Page,
	kind: "Add points" | "Multiply" | "Replace grade",
	value: string,
) {
	await page.getByRole("button", { name: "Add bonus", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Add bonus" });
	await dialog.getByRole("radio", { name: kind }).check();
	await dialog.getByLabel("Value").fill(value);
	await dialog.getByLabel(/^Reason/).fill("Because");
	await dialog.getByRole("button", { name: "Add bonus", exact: true }).click();
	return dialog;
}

test("the adjustments page shows who revoked an adjustment", async ({
	page,
}) => {
	const w = await world(page, "scr-revoked");
	const revoker = await seedUser({
		role: "INSTRUCTOR",
		username: "scr-revoked-other",
		name: "scr-revoked-other",
	});
	const [made] = await adjust(w, [w.ana.username]);
	const key = {
		course: w.course.id,
		exam: w.exam.slug,
		publicId: made?.publicId ?? "",
	};
	await db.examAdjustment.revoke(key, { actor: w.teacher });
	// Arrangement: the service records the acting instructor, who is also the author here.
	await prisma.examAdjustment.update({
		where: { publicId: key.publicId },
		data: { revokedById: revoker.username },
	});

	await page.goto(`${w.examUrl}/adjustments`);

	const row = page
		.getByRole("table", { name: "Adjustments", exact: true })
		.getByRole("row")
		.filter({ hasText: "Ana Prado" });
	await expect(row).toContainText("Revoked");
	await expect(row).toContainText(
		new RegExp(`revoked by\\s+${revoker.username}`, "i"),
	);
});

test("a range the server refuses writes nothing: add 0, replace with 120, multiply by 250", async ({
	page,
}) => {
	const w = await world(page, "scr-range");
	await page.goto(`${w.examUrl}/attempts/${w.ana.username}`);
	const before = await activeCount(w);

	for (const [kind, value] of [
		["Add points", "0"],
		["Replace grade", "120"],
		["Multiply", "250"],
	] as const) {
		const dialog = await addBonus(page, kind, value);
		await expect(dialog.getByRole("alert")).toBeVisible();
		expect(await activeCount(w)).toBe(before);
		await dialog.getByRole("button", { name: "Cancel" }).click();
		await expect(dialog).toBeHidden();
	}

	await expect(summary(page)).toHaveCount(0);
});

test("a replacement is edited from the pencil of the summary and from the adjustments page", async ({
	page,
}) => {
	const w = await world(page, "scr-edit");
	await adjust(w, [w.ana.username], { op: "SET", value: "0.8" });
	await page.goto(`${w.examUrl}/attempts/${w.ana.username}`);
	await expect(summary(page)).toContainText(/Final total\s*80%/);

	await summary(page).getByRole("button", { name: "Edit" }).click();
	const edit = page.getByRole("dialog", { name: "Edit adjustment" });
	await edit.getByLabel("Value").fill("70");
	await edit.getByRole("button", { name: "Save" }).click();

	await expect(edit).toBeHidden();
	await expect(summary(page)).toContainText("Grade replaced by 70%");
	await expect(summary(page)).toContainText(/Original total\s*50%/);
	await expect(summary(page)).toContainText(/Final total\s*70%/);

	await page.goto(`${w.examUrl}/adjustments`);
	const row = page
		.getByRole("table", { name: "Adjustments", exact: true })
		.getByRole("row")
		.filter({ hasText: "Ana Prado" });
	await row.getByRole("button", { name: "Edit" }).click();
	const again = page.getByRole("dialog", { name: "Edit adjustment" });
	await expect(again.getByLabel("Value")).toHaveValue("70");
	await again.getByLabel("Value").fill("60");
	await again.getByRole("button", { name: "Save" }).click();
	await expect(again).toBeHidden();
	await expect(row).toContainText("Grade replaced by 60%");

	await page.goto(`${w.examUrl}/attempts/${w.ana.username}`);
	await expect(summary(page)).toContainText(/Final total\s*60%/);
	await page.goto(`${w.examUrl}/results`);
	await expect(
		page
			.getByRole("table", { name: "Results", exact: true })
			.getByRole("row")
			.filter({ hasText: "Ana Prado" })
			.getByRole("insertion"),
	).toHaveText("60%");
});

test("a bonus on a student at 100% keeps the total at 100% and still lists the line", async ({
	page,
}) => {
	const w = await world(page, "scr-cap");
	await page.goto(`${w.examUrl}/attempts/${w.davi.username}`);

	await page.getByRole("button", { name: "Add bonus", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Add bonus" });
	await dialog.getByRole("radio", { name: "Add points" }).check();
	await dialog.getByLabel("Value").fill("10");
	await dialog.getByLabel(/^Reason/).fill("Extra credit");
	await dialog.getByRole("button", { name: "Add bonus", exact: true }).click();

	await expect(dialog).toBeHidden();
	await expect(summary(page)).toContainText("Bonus +10");
	await expect(summary(page)).toContainText(/Original total\s*100%/);
	await expect(summary(page)).toContainText(/Final total\s*100%/);
});

test("the trash of a line in the summary removes the adjustment and the original total comes back", async ({
	page,
}) => {
	const w = await world(page, "scr-trash");
	await adjust(w, [w.ana.username]);
	await page.goto(`${w.examUrl}/attempts/${w.ana.username}`);
	await expect(summary(page)).toContainText("Bonus +10");

	await summary(page).getByRole("button", { name: "Revoke" }).click();
	const confirm = page.getByRole("dialog", { name: "Revoke adjustment" });
	await confirm
		.getByRole("button", { name: "Revoke adjustment", exact: true })
		.click();

	await expect(confirm).toBeHidden();
	await expect(page.getByText("Bonus +10")).toHaveCount(0);
	await expect(summary(page)).toHaveCount(0);
	await page.goto(`${w.examUrl}/results`);
	const ana = page
		.getByRole("table", { name: "Results", exact: true })
		.getByRole("row")
		.filter({ hasText: "Ana Prado" });
	await expect(ana).toContainText("50%");
	await expect(ana.getByRole("deletion")).toHaveCount(0);
});

test("an undo the server refuses shows an error on the page", async ({
	page,
}) => {
	const w = await world(page, "scr-undo");
	await page.goto(`${w.examUrl}/attempts/${w.ana.username}`);
	const article = page.getByRole("article", {
		name: "Question 3",
		exact: true,
	});
	await article.getByRole("button", { name: "Change grade" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Grade (0 to 100)").fill("100");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(article).toContainText("changed by hand");

	// Another tab takes the change back, so the Undo on this page is stale.
	const submission = await prisma.submission.findFirstOrThrow({
		where: {
			response: { authorId: w.ana.username, examId: w.exam.id },
			question: { slug: "q-three" },
		},
		orderBy: { id: "desc" },
	});
	const revert = {
		course: w.course.id,
		exam: w.exam.slug,
		submission: submission.publicId,
	};
	await db.manualGrade.revert(revert, { actor: w.teacher });
	await expect(
		db.manualGrade.revert(revert, { actor: w.teacher }),
	).rejects.toBeInstanceOf(InvalidData);

	await article.getByRole("button", { name: "Undo" }).click();

	await expect(page.getByRole("alert")).toBeVisible();
});
