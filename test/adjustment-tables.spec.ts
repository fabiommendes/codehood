import { prisma } from "@/db/client";
import { expect, type Locator, type Page, test } from "./fixtures";
import {
	type AdjustableExam,
	adjust,
	adjustableExam,
} from "./stories/adjustment-support";
import { logInAs, resetDatabase } from "./stories/helpers";

// The class's tables show what an adjustment does to a total: the original struck through, the final total,
// and a link to the exam's adjustments. Ana is at 50%, Bia at 75%, Davi and Fabio at 100%.

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

/// The row of `name` on the course's Grades table.
function gradesRow(page: Page, name: string): Locator {
	return page
		.getByRole("table", { name: "Grades", exact: true })
		.getByRole("row")
		.filter({ hasText: name });
}

/// The row of `name` on the exam's Results table.
function resultsRow(page: Page, name: string): Locator {
	return page
		.getByRole("table", { name: "Results", exact: true })
		.getByRole("row")
		.filter({ hasText: name });
}

/// The text color of `element`, as the browser resolves it.
function colorOf(element: Locator): Promise<string> {
	return element.evaluate((node) => getComputedStyle(node).color);
}

const TABLES = [
	["course grades", "grades", gradesRow],
	["exam results", "results", resultsRow],
] as const;

for (const [label, path, rowOf] of TABLES) {
	const open = async (page: Page, w: AdjustableExam) =>
		page.goto(path === "grades" ? `${w.href}/grades` : `${w.examUrl}/results`);

	test(`${label}: an adjusted total shows the original struck through beside the final one`, async ({
		page,
	}) => {
		const w = await world(page, `tbl-strike-${path}`);
		await adjust(w, [w.ana.username]);
		await adjust(w, [w.caio.username], { op: "SET", value: "0.8" });

		await open(page, w);

		await expect(rowOf(page, "Ana Prado").getByRole("deletion")).toHaveText(
			"50%",
		);
		await expect(rowOf(page, "Ana Prado").getByRole("insertion")).toHaveText(
			"60%",
		);
		await expect(rowOf(page, "Caio Nunes").getByRole("deletion")).toHaveText(
			"50%",
		);
		await expect(rowOf(page, "Caio Nunes").getByRole("insertion")).toHaveText(
			"80%",
		);
		await expect(rowOf(page, "Bia Lima").getByRole("deletion")).toHaveCount(0);
		await expect(rowOf(page, "Bia Lima")).toContainText("75%");
	});

	test(`${label}: an adjusted total links to the exam's adjustments`, async ({
		page,
	}) => {
		const w = await world(page, `tbl-link-${path}`);
		await adjust(w, [w.ana.username]);

		await open(page, w);

		await expect(
			rowOf(page, "Ana Prado").getByRole("link", { name: "Adjustments" }),
		).toHaveAttribute("href", `${w.examUrl}/adjustments`);
		await expect(
			rowOf(page, "Bia Lima").getByRole("link", { name: "Adjustments" }),
		).toHaveCount(0);
	});

	test(`${label}: two factors of 0.5 show as their real effect, 25%`, async ({
		page,
	}) => {
		const w = await world(page, `tbl-factors-${path}`);
		await adjust(w, [w.davi.username], { op: "FACTOR", value: "0.5" });
		await adjust(w, [w.davi.username], { op: "FACTOR", value: "0.5" });

		await open(page, w);

		const davi = rowOf(page, "Davi Rocha");
		await expect(davi.getByRole("deletion")).toHaveText("100%");
		await expect(davi.getByRole("insertion")).toHaveText("25%");
		await expect(davi).not.toContainText("50%");
	});

	test(`${label}: a total with a bonus is not shown in the colour of a penalty`, async ({
		page,
	}) => {
		const w = await world(page, `tbl-colour-${path}`);
		await adjust(w, [w.ana.username]);
		await adjust(w, [w.fabio.username], { op: "FACTOR", value: "0.5" });

		await open(page, w);

		const bonus = rowOf(page, "Ana Prado").getByRole("insertion");
		const penalty = rowOf(page, "Fabio Reis").getByRole("insertion");
		await expect(bonus).toHaveText("60%");
		await expect(penalty).toHaveText("50%");
		expect(await colorOf(bonus)).not.toBe(await colorOf(penalty));
	});

	test(`${label}: a question penalty alone strikes the total with no adjustment and links to the adjustments`, async ({
		page,
	}) => {
		const w = await world(page, `tbl-question-${path}`);
		await adjust(w, [w.davi.username], {
			op: "FACTOR",
			value: "0.5",
			question: "q-one",
		});

		await open(page, w);

		const davi = rowOf(page, "Davi Rocha");
		await expect(davi.getByRole("deletion")).toHaveText("100%");
		await expect(davi.getByRole("insertion")).toHaveText("88%");
		await expect(
			davi.getByRole("link", { name: "Adjustments" }),
		).toHaveAttribute("href", `${w.examUrl}/adjustments`);
		await expect(rowOf(page, "Fabio Reis").getByRole("deletion")).toHaveCount(
			0,
		);
	});

	test(`${label}: a question penalty with an exam bonus strikes the total with no adjustment at all`, async ({
		page,
	}) => {
		const w = await world(page, `tbl-mix-${path}`);
		await adjust(w, [w.davi.username], {
			op: "FACTOR",
			value: "0.4",
			question: "q-one",
		});
		await adjust(w, [w.davi.username]);
		await adjust(w, [w.davi.username], { op: "OFFSET", value: "0.05" });

		await open(page, w);

		const davi = rowOf(page, "Davi Rocha");
		await expect(davi.getByRole("deletion")).toHaveText("100%");
		await expect(davi.getByRole("insertion")).toHaveText("100%");
	});
}

test("a bonus total is not in the colour of a penalty, the `text-error` one", async ({
	page,
}) => {
	const w = await world(page, "tbl-bonus-colour");
	await adjust(w, [w.ana.username]);
	await page.goto(`${w.examUrl}/results`);

	const error = await page.evaluate(() => {
		const probe = document.createElement("span");
		probe.className = "text-error";
		probe.textContent = "x";
		document.body.append(probe);
		const color = getComputedStyle(probe).color;
		probe.remove();
		return color;
	});
	const bonus = resultsRow(page, "Ana Prado").getByRole("insertion");

	await expect(bonus).toHaveText("60%");
	expect(await colorOf(bonus)).not.toBe(error);
});

test("the attempt page summary keeps the question penalties in the original total", async ({
	page,
}) => {
	const w = await world(page, "tbl-summary");
	await adjust(w, [w.davi.username], {
		op: "FACTOR",
		value: "0.4",
		question: "q-one",
	});
	await adjust(w, [w.davi.username]);

	await page.goto(`${w.examUrl}/attempts/${w.davi.username}`);

	const summary = page.getByRole("region", { name: "Grade adjustments" });
	await expect(summary).toContainText(/Original total\s*85%/);
	await expect(summary).toContainText(/Final total\s*95%/);
});
