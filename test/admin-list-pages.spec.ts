import { FULL_ACCESS } from "@/auth/actor";
import type { Page as ListPage, PageParams } from "@/core/schemas";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedDisciplineFactory } from "@/fixtures/discipline.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { courseHref } from "@/urls";
import { localDateOf } from "@/utils/schedule-time";
import { expect, type Locator, type Page, test } from "./fixtures";
import { logInAs, seedUser } from "./stories/helpers";

/**
 * The lists that grow with the instance show one page read by the server,
 * and their forms come back to the page they were posted from. `?limit=2`
 * makes a second page out of a handful of rows. No `resetDatabase`: every
 * expectation is read from the services at the time of the test.
 */

/// The pager under a list.
const pager = (page: Page) => page.getByRole("navigation", { name: "Pages" });

/// The fieldset of `label` inside `scope`.
const group = (scope: Page | Locator, label: string) =>
	scope.getByRole("group", { name: label, exact: true });

/// The text of the `column`-th cell of every row of the table, 1-based.
const cells = (page: Page, column: number) => () =>
	page.locator(`tbody tr td:nth-child(${column})`).allInnerTexts();

/// The keys of the first three pages of a list, two rows each.
async function firstPages<Item>(
	find: (params: PageParams) => Promise<ListPage<Item>>,
	key: (item: Item) => string,
): Promise<string[][]> {
	const pages: string[][] = [];
	let after: string | undefined;
	for (let i = 0; i < 3; i++) {
		const { items, next } = await find({ limit: 2, after });
		pages.push(items.map(key));
		if (next === null) break;
		after = next;
	}
	expect(pages, "the list needs three pages of two rows").toHaveLength(3);
	return pages;
}

/// Opens `path` two rows a page, steps forward twice and back twice, and
/// leaves the browser on the second page.
async function stepThrough(
	page: Page,
	path: string,
	keys: () => Promise<string[]>,
	expected: string[][],
	total: number,
): Promise<void> {
	const [first = [], second = [], third = []] = expected;
	const previous = pager(page).getByRole("link", { name: "Previous" });
	const next = pager(page).getByRole("link", { name: "Next" });

	await page.goto(`${path}?limit=2`);
	expect(await keys()).toEqual(first);
	await expect(pager(page)).toContainText(
		`${total.toLocaleString("en")} in all`,
	);
	await expect(previous).toHaveCount(0);

	await next.click();
	await expect(page).toHaveURL(/[?&]after=/);
	await expect(page).toHaveURL(/[?&]limit=2/);
	expect(await keys()).toEqual(second);
	expect(second.filter((key) => first.includes(key))).toEqual([]);

	await next.click();
	await expect.poll(keys).toEqual(third);

	await previous.click();
	await expect.poll(keys).toEqual(second);
	await previous.click();
	await expect.poll(keys).toEqual(first);
	await expect(previous).toHaveCount(0);

	await next.click();
	await expect.poll(keys).toEqual(second);
}

test("the admin courses table pages through every course", async ({ page }) => {
	await persistedCourseFactory.createList(5);
	const admin = await seedUser({ role: "ADMIN" });
	await logInAs(page, admin);

	const expected = await firstPages(
		(params) => db.course.findPage(params, FULL_ACCESS),
		(course) =>
			courseHref({
				discipline: course.discipline.slug,
				instructor: course.instructor.username,
				edition: course.edition.slug,
			}),
	);
	const hrefs = () =>
		page
			.locator("tbody tr td:last-child a")
			.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));

	await stepThrough(
		page,
		"/admin/courses",
		hrefs,
		expected,
		await db.course.count({}, FULL_ACCESS),
	);

	await page.goto("/admin/courses");
	expect((await hrefs()).length).toBe(
		Math.min(50, await db.course.count({}, FULL_ACCESS)),
	);
});

test("the admin users table pages by username and its forms stay on the page", async ({
	page,
}) => {
	const admin = await seedUser({ role: "ADMIN" });
	for (let i = 0; i < 5; i++) await seedUser({ role: "STUDENT" });
	await logInAs(page, admin);

	const expected = await firstPages(
		(params) => db.user.findPage(params, FULL_ACCESS),
		(user) => `@${user.username}`,
	);
	const total = await db.user.count({}, FULL_ACCESS);
	const usernames = cells(page, 2);
	await stepThrough(page, "/admin/users", usernames, expected, total);
	await expect(
		page.getByText(`Every account on this Codehood instance: ${total} in`),
	).toBeVisible();

	const second = expected[1] ?? [];
	const target = (second[0] ?? "").slice(1);
	// By the whole cell: another username may start with this one.
	const row = page.getByRole("row").filter({
		has: page.getByRole("cell", { name: `@${target}`, exact: true }),
	});

	await test.step("a refused reset reopens the dialog of that row", async () => {
		const dialog = page.locator(`#reset-password-${target}`);
		await row.getByRole("button", { name: /^Reset password of / }).click();
		await group(dialog, "New password").locator("input").fill("short");
		const form = dialog.locator("form[action*='resetPassword']");
		await form.evaluate((element: HTMLFormElement) => {
			element.noValidate = true;
		});
		await dialog.getByRole("button", { name: "Reset password" }).click();
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText("at least 8");
		expect(await usernames()).toEqual(second);
		await page.keyboard.press("Escape");
	});

	await test.step("a forced logout answers on the same page", async () => {
		await row.getByRole("button", { name: /^Force logout / }).click();
		await page
			.locator(`#force-logout-${target}`)
			.getByRole("button", { name: "Log out" })
			.click();
		await expect(
			page.getByText("Every session for that account has been logged out."),
		).toBeVisible();
		expect(await usernames()).toEqual(second);
		await expect(
			pager(page).getByRole("link", { name: "Next" }),
		).toHaveAttribute("href", /^\/admin\/users\?limit=2&after=/);
	});

	await test.step("a new account is created from the same page", async () => {
		const username = `zzzz-${Math.random().toString(36).slice(2, 10)}`;
		await page.getByRole("button", { name: "Add new user" }).click();
		const dialog = page.locator("#add-user-dialog");
		for (const [label, value] of Object.entries({
			Name: "Paged Peter",
			Email: `${username}@codehood.test`,
			Username: username,
			"GitHub id": `gh-${username}`,
			"School id": `sc-${username}`,
			Password: `quartz-${username}-plumb-97`,
		}))
			await group(dialog, label).locator("input").fill(value);
		await dialog.getByRole("button", { name: "Add user" }).click();

		await expect(
			page.getByRole("alert").filter({ hasText: `@${username}` }),
		).toBeVisible();
		expect(await db.user.findOne({ username }, FULL_ACCESS)).not.toBeNull();
		expect(await usernames()).toEqual(second);
		await expect(pager(page)).toContainText(
			`${(total + 1).toLocaleString("en")} in all`,
		);
	});
});

test("the admin disciplines table pages by slug and its forms stay on the page", async ({
	page,
}) => {
	await persistedDisciplineFactory.createList(5);
	const admin = await seedUser({ role: "ADMIN" });
	await logInAs(page, admin);

	const expected = await firstPages(
		(params) => db.discipline.findPage(params, FULL_ACCESS),
		(discipline) => discipline.slug,
	);
	const total = await db.discipline.count({}, FULL_ACCESS);
	const slugs = cells(page, 1);
	await stepThrough(page, "/admin/disciplines", slugs, expected, total);

	const second = expected[1] ?? [];
	const target = second[0] ?? "";

	await test.step("an edit saves and shows the row it changed", async () => {
		const dialog = page.locator(`[id="edit-discipline-${target}"]`);
		await page
			.getByRole("button", { name: `Edit ${target}`, exact: true })
			.click();
		await group(dialog, "Name").locator("input").fill("Renamed On Page Two");
		await dialog.getByRole("button", { name: "Save" }).click();

		await expect(page.getByText("Discipline updated.")).toBeVisible();
		expect(await slugs()).toEqual(second);
		await expect(
			page.getByRole("row").filter({ hasText: target }),
		).toContainText("Renamed On Page Two");
	});

	await test.step("a new discipline is created from the same page", async () => {
		const slug = `zzz${Math.random().toString(36).slice(2, 10)}`;
		await group(page, "Slug").locator("input").first().fill(slug);
		await group(page, "Name").locator("input").first().fill("Last One");
		await page.getByRole("button", { name: "New discipline" }).click();

		await expect(
			page.getByRole("alert").filter({ hasText: `"${slug}" created` }),
		).toBeVisible();
		expect(await slugs()).toEqual(second);
		await expect(pager(page)).toContainText(
			`${(total + 1).toLocaleString("en")} in all`,
		);
	});
});

test("the admin editions table pages latest first and its forms stay on the page", async ({
	page,
}) => {
	await persistedEditionFactory.createList(5);
	const admin = await seedUser({ role: "ADMIN" });
	await logInAs(page, admin);

	const expected = await firstPages(
		(params) => db.edition.findPage(params, FULL_ACCESS),
		(edition) => edition.slug,
	);
	const all = expected.flat();
	expect(all).toEqual([...all].sort().reverse());
	const slugs = cells(page, 1);
	await stepThrough(
		page,
		"/admin/editions",
		slugs,
		expected,
		await db.edition.count({}, FULL_ACCESS),
	);

	const second = expected[1] ?? [];
	const target = second[0] ?? "";
	const dialog = page.locator(`[id="edit-edition-${target}"]`);

	await test.step("a refused edit reopens the dialog of that row", async () => {
		await page
			.getByRole("button", { name: `Edit ${target}`, exact: true })
			.click();
		await group(dialog, "Starts").locator("input").fill("2030-12-15");
		await group(dialog, "Ends").locator("input").fill("2030-08-01");
		await dialog.getByRole("button", { name: "Save" }).click();

		await expect(dialog).toBeVisible();
		await expect(group(dialog, "Ends")).toContainText(
			"Must not be before the start date.",
		);
		expect(await slugs()).toEqual(second);
	});

	await test.step("and the corrected edit saves on the same page", async () => {
		await group(dialog, "Name").locator("input").fill("Paged term");
		await group(dialog, "Ends").locator("input").fill("2031-08-01");
		await dialog.getByRole("button", { name: "Save" }).click();

		await expect(page.getByText("Edition updated.")).toBeVisible();
		expect(await slugs()).toEqual(second);
		await expect(
			page.getByRole("row").filter({ hasText: "Paged term" }),
		).toContainText(target);
	});
});

test("the course grid pages through the courses of whoever reads it", async ({
	page,
}) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	for (let i = 0; i < 3; i++)
		await persistedCourseFactory.create({ instructor: instructor.username });
	const cards = page.locator("main a.card");
	const hrefs = () =>
		cards.evaluateAll((links) => links.map((a) => a.getAttribute("href")));

	await test.step("an instructor sees their own three, two at a time", async () => {
		await logInAs(page, instructor);
		await page.goto("/courses?limit=2");
		await expect(cards).toHaveCount(2);
		await expect(pager(page)).toContainText("3 in all");
		const first = await hrefs();

		await pager(page).getByRole("link", { name: "Next" }).click();
		await expect(cards).toHaveCount(1);
		expect(first).not.toContain((await hrefs())[0]);
		await expect(pager(page).getByRole("link", { name: "Next" })).toHaveCount(
			0,
		);

		await pager(page).getByRole("link", { name: "Previous" }).click();
		await expect.poll(hrefs).toEqual(first);

		await page.goto("/courses");
		await expect(cards).toHaveCount(3);
		await expect(pager(page)).toHaveCount(0);
	});

	await test.step("an admin steps through every course", async () => {
		await persistedCourseFactory.createList(2);
		const admin = await seedUser({ role: "ADMIN" });
		await logInAs(page, admin);
		const expected = await firstPages(
			(params) => db.course.findPage(params, FULL_ACCESS),
			(course) =>
				courseHref({
					discipline: course.discipline.slug,
					instructor: course.instructor.username,
					edition: course.edition.slug,
				}),
		);
		await stepThrough(
			page,
			"/courses",
			async () => (await hrefs()).map((href) => href ?? ""),
			expected,
			await db.course.count({}, FULL_ACCESS),
		);
	});
});

test("a cursor that leads nowhere shows the first page of the list", async ({
	page,
}) => {
	await persistedDisciplineFactory.createList(3);
	const admin = await seedUser({ role: "ADMIN" });
	await logInAs(page, admin);
	const first = await db.discipline.findPage({ limit: 2 }, FULL_ACCESS);

	await page.goto("/admin/disciplines?limit=2&after=zzzzzzzzzzzzzzzzzzzz");
	expect(await cells(page, 1)()).toEqual(
		first.items.map((discipline) => discipline.slug),
	);
	await expect(pager(page).getByRole("link", { name: "Next" })).toBeVisible();

	const unreadable = await page.goto("/admin/courses?after=not%20a%20cursor");
	expect(unreadable?.status()).toBe(200);
	await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("the admin overview counts disciplines and editions without listing them", async ({
	page,
}) => {
	await persistedDisciplineFactory.createList(4);
	await persistedEditionFactory.create({
		startDate: localDateOf(new Date(Date.now() - 86_400_000)),
		endDate: localDateOf(new Date(Date.now() + 86_400_000)),
	});
	const admin = await seedUser({ role: "ADMIN" });
	await logInAs(page, admin);

	const disciplines = await db.discipline.count({}, FULL_ACCESS);
	const sample = await db.discipline.findPage({ limit: 3 }, FULL_ACCESS);
	const editions = await db.edition.count({}, FULL_ACCESS);
	const live = await db.edition.count({ active: true }, FULL_ACCESS);
	expect(live).toBeGreaterThan(0);
	const stat = (title: string) =>
		page.locator(".stat").filter({
			has: page.locator(".stat-title", { hasText: new RegExp(`^${title}$`) }),
		});

	await page.goto("/admin");
	await expect(stat("Disciplines").locator(".stat-value")).toHaveText(
		String(disciplines),
	);
	await expect(stat("Disciplines").locator(".stat-desc")).toHaveText(
		`${sample.items.map((discipline) => discipline.slug).join(", ")} & ${disciplines - 3} more`,
	);
	await expect(stat("Editions").locator(".stat-value")).toHaveText(
		String(editions),
	);
	await expect(stat("Editions").locator(".stat-desc")).toHaveText(
		`${live} live now`,
	);
	await expect(stat("Courses").locator(".stat-value")).toHaveText(
		String(await db.course.count({}, FULL_ACCESS)),
	);
});
