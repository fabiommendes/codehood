import { expect, test } from "./fixtures";

/// The theme pages of `/design/components`, the sections each one shows and the islands that hydrate.
const pages: {
	path: string;
	sections: string[];
	islands: string[];
}[] = [
	{
		path: "ui",
		sections: ["Empty states", "Fields", "Password", "Files", "Glass wall"],
		islands: [],
	},
	{
		path: "course",
		sections: ["Headers", "Course tiles and rows"],
		islands: [],
	},
	{
		path: "schedule",
		sections: ["Check-in", "Roll call", "Projection", "Open a roll call"],
		islands: [],
	},
	{
		path: "exams",
		sections: [
			"Exam rows",
			"Question labels",
			"Exam exceptions",
			"Exam results",
			"Grade release",
		],
		// Only the sortable table hydrates; it calls no action and does not poll.
		islands: ["ExamResults"],
	},
	{
		path: "grading",
		sections: ["Regrades", "Applied items", "Statistics"],
		islands: ["QuestionStats"],
	},
	{
		path: "reports",
		sections: ["Reports", "Report filters"],
		islands: [],
	},
];

for (const { path, sections, islands } of pages) {
	test(`design/components/${path} renders every section without errors or action calls`, async ({
		page,
	}) => {
		const errors: string[] = [];
		const actionCalls: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("request", (request) => {
			if (request.url().includes("/_actions/")) actionCalls.push(request.url());
		});

		const response = await page.goto(`/design/components/${path}`);
		expect(response?.status()).toBe(200);

		for (const title of sections) {
			await expect(
				page.getByRole("heading", { level: 2, name: title, exact: true }),
			).toBeVisible();
		}
		const names = await page
			.locator("astro-island")
			.evaluateAll((nodes) =>
				nodes.map((node) => JSON.parse(node.getAttribute("opts") ?? "{}").name),
			);
		expect(new Set(names)).toEqual(new Set(islands));

		await page.waitForTimeout(1000);
		expect(errors).toEqual([]);
		expect(actionCalls).toEqual([]);
	});
}

test("design/components links every theme page", async ({ page }) => {
	const response = await page.goto("/design/components");
	expect(response?.status()).toBe(200);
	for (const { path } of pages) {
		await expect(
			page.locator(`main a[href="/design/components/${path}"]`),
		).toHaveCount(1);
	}
});

test("a table sorts only with two rows or more and says when it is empty", async ({
	page,
}) => {
	await page.goto("/design/components/exams");
	const variant = (key: string) =>
		page.locator(`[data-variant-group="results"][data-variant="${key}"]`);

	const many = variant("pending").getByRole("table");
	const firstStudent = many.getByRole("row").nth(1).getByRole("link");
	await expect(firstStudent).toHaveText("Ana Beatriz Souza");
	await many.getByRole("button", { name: "Student" }).click();
	await expect(firstStudent).toHaveText("Fábio Teixeira");

	await page.goto("/design/components/exams?results=none");
	const none = variant("none").getByRole("table");
	await expect(
		none.getByRole("columnheader", { name: "Student" }),
	).toBeVisible();
	await expect(none.getByRole("button")).toHaveCount(0);
	await expect(none.getByRole("cell")).toHaveText("No attempts yet.");
});

test("design/components shows one variant at a time and keeps it in the URL", async ({
	page,
}) => {
	await page.goto("/design/components/exams");
	const section = page.locator("#results");
	const variant = (key: string) =>
		section.locator(`[data-variant-group="results"][data-variant="${key}"]`);
	await expect(variant("pending")).toBeVisible();
	await expect(variant("graded")).toBeHidden();
	await expect(variant("none")).toBeHidden();

	await section.getByRole("button", { name: "Everything graded" }).click();
	await expect(variant("graded")).toBeVisible();
	await expect(variant("pending")).toBeHidden();
	await expect(
		section.getByRole("button", { name: "Everything graded" }),
	).toHaveAttribute("aria-pressed", "true");
	await expect(page).toHaveURL(/[?&]results=graded/);

	await page.reload();
	await expect(variant("graded")).toBeVisible();
	await expect(variant("pending")).toBeHidden();
});
