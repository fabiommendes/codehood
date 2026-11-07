import { expect, test } from "@playwright/test";
import { logInAs, openTab, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

const key = (user: string) => `codehood:code-draft:${user}:c:e:q`;
const value = JSON.stringify({ code: "x", savedAt: Date.now() });

test("logging out from the menu removes every draft but keeps other keys", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/courses");
	await page.evaluate(
		([a, b, v]) => {
			localStorage.setItem(a as string, v as string);
			localStorage.setItem(b as string, v as string);
			localStorage.setItem("theme", "dark");
		},
		[key(student.username), key("someone-else"), value],
	);

	const menu = page.locator("details.dropdown");
	await menu.locator("summary").click();
	await menu.getByRole("button", { name: "Log out" }).click();
	await page.waitForLoadState("load");

	const keys = await page.evaluate(() => Object.keys(localStorage));
	expect(keys.filter((k) => k.startsWith("codehood:code-draft:"))).toEqual([]);
	expect(keys).toContain("theme");
});

test("logging out everywhere from the profile removes the drafts", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/profile");
	await page.evaluate(
		([k, v]) => localStorage.setItem(k as string, v as string),
		[key(student.username), value],
	);

	await openTab(page, "Account");
	await page.getByRole("button", { name: "Log out everywhere" }).click();
	await page.waitForLoadState("load");

	const keys = await page.evaluate(() => Object.keys(localStorage));
	expect(keys.filter((k) => k.startsWith("codehood:code-draft:"))).toEqual([]);
});

test("opening a page as another user removes the previous user's drafts", async ({
	page,
}) => {
	const first = await seedUser({ role: "STUDENT" });
	const second = await seedUser({ role: "STUDENT" });
	await logInAs(page, first);
	await page.goto("/courses");
	await page.evaluate(
		([k, v]) => localStorage.setItem(k as string, v as string),
		[key(first.username), value],
	);

	await page.context().clearCookies();
	await logInAs(page, second);
	await page.goto("/courses");

	await expect
		.poll(() =>
			page.evaluate(() =>
				Object.keys(localStorage).filter((k) =>
					k.startsWith("codehood:code-draft:"),
				),
			),
		)
		.toEqual([]);
});
