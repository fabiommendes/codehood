import { expect, test } from "./fixtures";

/// The browser-paged demo table of the design catalogue: 230 rows, 20 a page.
const section = (page: import("@playwright/test").Page) =>
	page.locator("section", {
		has: page.getByRole("heading", { name: "PaginatedTable", exact: true }),
	});

test("a browser-paged table shows one page and moves through the pager", async ({
	page,
}) => {
	await page.goto("/design/elements");
	const demo = section(page);
	const local = demo.getByRole("navigation").first();
	const bodyRows = demo.locator("table").first().locator("tbody tr");

	await expect(bodyRows).toHaveCount(20);
	await expect(local).toContainText("1–20 of 230");
	await expect(local.getByRole("button", { name: "Previous" })).toBeDisabled();
	await expect(
		local.getByRole("button", { name: "Page 1", exact: true }),
	).toHaveAttribute("aria-current", "page");

	await local.getByRole("button", { name: "Page 12", exact: true }).click();
	await expect(local).toContainText("221–230 of 230");
	await expect(bodyRows).toHaveCount(10);
	await expect(local.getByRole("button", { name: "Next" })).toBeDisabled();

	await local.getByRole("button", { name: "Previous" }).click();
	await expect(local).toContainText("201–220 of 230");
});

test("sorting a browser-paged table returns it to the first page", async ({
	page,
}) => {
	await page.goto("/design/elements");
	const demo = section(page);
	const local = demo.getByRole("navigation").first();
	const table = demo.locator("table").first();

	await local.getByRole("button", { name: "Page 3", exact: true }).click();
	await expect(local).toContainText("41–60 of 230");

	await table.getByRole("button", { name: "Name" }).click();
	await expect(local).toContainText("1–20 of 230");
	await expect(table.locator("tbody tr").first()).toContainText("Student 230");
});

test("a server-paged table links to its neighbours and sorts through the URL", async ({
	page,
}) => {
	await page.goto("/design/elements");
	const demo = section(page);
	const cursor = demo.getByRole("navigation").last();
	const table = demo.locator("table").last();

	await expect(cursor).toContainText("20,000 in all");
	await expect(cursor.getByRole("link", { name: "Previous" })).toHaveAttribute(
		"href",
		"?cursor=a",
	);
	await expect(cursor.getByRole("link", { name: "Next" })).toHaveAttribute(
		"href",
		"?cursor=c",
	);
	await expect(table.getByRole("link", { name: "Name" })).toHaveAttribute(
		"href",
		"?sort=name",
	);
	await expect(table.locator("tbody tr")).toHaveCount(2);
});
