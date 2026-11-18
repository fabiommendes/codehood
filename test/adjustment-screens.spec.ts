import { InvalidData } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { expect, type Page, test } from "./fixtures";
import {
	type AdjustableExam,
	adjust,
	adjustableExam,
	pendingExam,
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

/// Sanctions the whole exam of the attempt on display, through the dialog; `kept` is the percentage that stays, or `"zero"`.
async function sanctionExam(page: Page, kept: string, reason: string) {
	await page.getByRole("button", { name: "Sanction", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Sanction", exact: true });
	if (kept === "zero") await dialog.getByLabel("Zero").check();
	else await dialog.getByLabel("% of the grade kept").fill(kept);
	await dialog.getByLabel(/^Reason/).fill(reason);
	await dialog.getByRole("button", { name: "Sanction", exact: true }).click();
	return dialog;
}

test("a penalty on a student who has a bonus applies first, then the bonus: 50% kept of 50%, plus 10, is 35%", async ({
	page,
}) => {
	const w = await world(page, "scr-order");
	await adjust(w, [w.ana.username], { reason: "Participation" });
	await page.goto(`${w.examUrl}/attempts/${w.ana.username}`);
	await expect(summary(page)).toContainText(/Final total\s*60%/);

	const dialog = await sanctionExam(page, "50", "Consultation not authorised");

	await expect(dialog).toBeHidden();
	await expect(summary(page)).toContainText(/Original total\s*50%/);
	await expect(summary(page)).toContainText(/Penalty ×0\.5[\s\S]*Bonus \+10/);
	await expect(summary(page)).toContainText(/Final total\s*35%/);
});

test("zeroing the exam gives 0% over a replacement and a bonus, which stay listed", async ({
	page,
}) => {
	const w = await world(page, "scr-zero-set");
	await adjust(w, [w.davi.username], { op: "SET", value: "0.8" });
	await adjust(w, [w.davi.username], { op: "OFFSET", value: "0.1" });
	await page.goto(`${w.examUrl}/attempts/${w.davi.username}`);
	await expect(summary(page)).toContainText(/Final total\s*90%/);

	const dialog = await sanctionExam(page, "zero", "Cheating");

	await expect(dialog).toBeHidden();
	await expect(summary(page)).toContainText("Zeroed");
	await expect(summary(page)).toContainText("Grade replaced by 80%");
	await expect(summary(page)).toContainText("Bonus +10");
	await expect(summary(page)).toContainText(/Final total\s*0%/);
});

test("the sanction of a question offers no bonus, refuses a share above 100 and a second sanction on the same question", async ({
	page,
}) => {
	const w = await world(page, "scr-question");
	await page.goto(`${w.examUrl}/attempts/${w.bia.username}`);
	const article = page.getByRole("article", {
		name: "Question 1",
		exact: true,
	});

	await article.getByRole("button", { name: "Sanction question" }).click();
	const dialog = page.getByRole("dialog", { name: /Sanction question/ });
	await expect(dialog.getByRole("radio")).toHaveCount(0);
	await expect(dialog.getByLabel("% of the grade kept")).toBeVisible();
	await dialog.getByLabel("% of the grade kept").fill("110");
	await dialog.getByLabel(/^Reason/).fill("A bonus in disguise");
	await dialog
		.getByRole("button", { name: "Sanction question", exact: true })
		.click();
	await expect(dialog.getByRole("alert")).toBeVisible();
	expect(await activeCount(w)).toBe(0);

	await dialog.getByLabel("% of the grade kept").fill("50");
	await dialog
		.getByRole("button", { name: "Sanction question", exact: true })
		.click();
	await expect(dialog).toBeHidden();
	await expect(article).toContainText("Penalty ×0.5");
	expect(await activeCount(w)).toBe(1);

	// The hammer gives way to the edit of the sanction: a second one is not offered, and the service refuses it.
	await expect(
		article.getByRole("button", { name: "Sanction question" }),
	).toHaveCount(0);
	await expect(article.getByRole("button", { name: "Edit" })).toBeVisible();
	await expect(
		adjust(w, [w.bia.username], {
			op: "FACTOR",
			value: "0.2",
			question: "q-one",
			reason: "Second time",
		}),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await activeCount(w)).toBe(1);

	await article.getByRole("button", { name: "Edit" }).click();
	const edit = page.getByRole("dialog", { name: "Edit adjustment" });
	await edit.getByLabel("% of the grade kept").fill("20");
	await edit.getByRole("button", { name: "Save" }).click();
	await expect(edit).toBeHidden();
	await expect(article).toContainText("Penalty ×0.2");
	expect(await activeCount(w)).toBe(1);
});

test("the grading page of a question marks a sanction only on a student whose adjustment targets that question", async ({
	page,
}) => {
	const w = await world(page, "scr-badge");
	await adjust(w, [w.bia.username], {
		op: "FACTOR",
		value: "0.5",
		question: "q-one",
		reason: "Copied",
	});
	await adjust(w, [w.caio.username], {
		op: "FACTOR",
		value: "0.5",
		reason: "Whole exam",
	});
	await adjust(w, [w.davi.username], {
		op: "FACTOR",
		value: "0.5",
		question: "q-two",
		reason: "Other question",
	});

	await page.goto(`${w.examUrl}/grading/q-one`);

	const changed = page.locator("section#overrides");
	await expect(
		changed.getByRole("row").filter({ hasText: "Bia Lima" }),
	).toContainText("Sanction");
	await expect(changed).not.toContainText("Caio Nunes");
	await expect(changed).not.toContainText("Davi Rocha");
	await expect(changed.getByRole("heading")).toContainText("(1)");
});

test("a total still pending shows next to a bonus, and zeroing the exam settles it at 0%", async ({
	page,
}) => {
	const w = await world(page, "scr-pending");
	const pending = await pendingExam(w, "scr-pending");
	await db.examAdjustment.create(
		{
			course: w.course.id,
			exam: pending.exam.slug,
			usernames: [pending.pia.username],
			op: "OFFSET",
			value: "0.1",
			reason: "Participation",
		},
		{ actor: w.teacher },
	);
	await page.goto(`${pending.url}/attempts/${pending.pia.username}`);

	await expect(summary(page)).toContainText("Bonus +10");
	await expect(summary(page)).toContainText(/Original total\s*pending/);
	await expect(summary(page)).toContainText(/Final total\s*pending/);

	const dialog = await sanctionExam(page, "zero", "Cheating");

	await expect(dialog).toBeHidden();
	await expect(summary(page)).toContainText("Zeroed");
	await expect(summary(page)).toContainText(/Final total\s*0%/);
	await expect(summary(page)).not.toContainText(/Final total\s*pending/);
});

test("the results show a zeroed student with a total of 0% although an essay is pending", async ({
	page,
}) => {
	const w = await world(page, "scr-pending-results");
	const pending = await pendingExam(w, "scr-pending-results");
	await db.examAdjustment.create(
		{
			course: w.course.id,
			exam: pending.exam.slug,
			usernames: [pending.pia.username],
			op: "FACTOR",
			value: "0",
			reason: "Cheating",
		},
		{ actor: w.teacher },
	);

	await page.goto(`${pending.url}/results`);

	const row = page
		.getByRole("table", { name: "Results", exact: true })
		.getByRole("row")
		.filter({ hasText: "Pia Costa" });
	await expect(row.getByRole("insertion")).toHaveText("0%");
});

test("releasing the grades is not blocked by the empty attempt a replacement created", async ({
	page,
}) => {
	const w = await adjustableExam("scr-release");
	await adjust(w, [w.hana.username], { op: "SET", value: "0.7" });
	await logInAs(page, w.teacher);
	await page.goto(w.examUrl);

	await page.getByRole("button", { name: "Release results" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Release results" })
		.click();

	await expect(page.getByText(/^Released/)).toBeVisible();
	const released = await prisma.exam.findUniqueOrThrow({
		where: { id: w.exam.id },
	});
	expect(released.gradesReleasedAt).not.toBeNull();
});
