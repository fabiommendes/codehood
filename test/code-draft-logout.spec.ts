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

	page.on("dialog", (dialog) => void dialog.accept());
	const menu = page.locator("details.dropdown");
	await menu.locator("summary").click();
	await menu.getByRole("button", { name: "Log out" }).click();
	await page.waitForLoadState("load");

	const keys = await page.evaluate(() => Object.keys(localStorage));
	expect(keys.filter((k) => k.startsWith("codehood:code-draft:"))).toEqual([]);
	expect(keys).toContain("theme");
});

test("logging out with an unsaved draft asks first, and cancelling keeps the session and the draft", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/courses");
	await page.evaluate(
		([k, v]) => localStorage.setItem(k as string, v as string),
		[key(student.username), value],
	);
	const messages: string[] = [];
	page.on("dialog", (dialog) => {
		messages.push(dialog.message());
		void dialog.dismiss();
	});

	const menu = page.locator("details.dropdown");
	await menu.locator("summary").click();
	await menu.getByRole("button", { name: "Log out" }).click();

	await expect.poll(() => messages.length).toBe(1);
	expect(messages[0]).toMatch(/draft/i);
	expect(messages[0]).toMatch(/delete|erase|remove/i);
	await page.waitForTimeout(500);
	expect(await draftKeys(page)).toEqual([key(student.username)]);
	await page.goto("/profile");
	await expect(page).toHaveURL(/\/profile/);
});

test("logging out everywhere with an unsaved draft asks first", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/profile");
	await page.evaluate(
		([k, v]) => localStorage.setItem(k as string, v as string),
		[key(student.username), value],
	);
	let asked = 0;
	page.on("dialog", (dialog) => {
		asked++;
		void dialog.accept();
	});

	await openTab(page, "Account");
	await page.getByRole("button", { name: "Log out everywhere" }).click();
	await page.waitForLoadState("load");

	expect(asked).toBe(1);
	await expect.poll(() => draftKeys(page)).toEqual([]);
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

	page.on("dialog", (dialog) => void dialog.accept());
	await openTab(page, "Account");
	await page.getByRole("button", { name: "Log out everywhere" }).click();
	await page.waitForLoadState("load");

	const keys = await page.evaluate(() => Object.keys(localStorage));
	expect(keys.filter((k) => k.startsWith("codehood:code-draft:"))).toEqual([]);
});

const draftKeys = (page: import("@playwright/test").Page) =>
	page.evaluate(() =>
		Object.keys(localStorage).filter((k) =>
			k.startsWith("codehood:code-draft:"),
		),
	);

test("a page opened without a user removes every draft", async ({ page }) => {
	await page.goto("/login");
	await page.evaluate(
		([k, v]) => localStorage.setItem(k as string, v as string),
		[key("ada"), value],
	);
	await page.goto("/login");
	await expect.poll(() => draftKeys(page)).toEqual([]);

	await page.evaluate(
		([k, v]) => localStorage.setItem(k as string, v as string),
		[key("ada"), value],
	);
	await page.goto("/this-page-does-not-exist");
	await expect.poll(() => draftKeys(page)).toEqual([]);
});

test("a centered page opened by another user removes the previous user's drafts", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/courses");
	await page.evaluate(
		([a, b, v]) => {
			localStorage.setItem(a as string, v as string);
			localStorage.setItem(b as string, v as string);
		},
		[key(student.username), key("someone-else"), value],
	);
	await page.goto("/check-in");
	await expect.poll(() => draftKeys(page)).toEqual([key(student.username)]);
});

test("a page raises no script error when the browser blocks localStorage", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.addInitScript(() => {
		Object.defineProperty(window, "localStorage", {
			get() {
				throw new DOMException("blocked", "SecurityError");
			},
		});
	});
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/courses");
	await page.waitForLoadState("load");

	expect(errors).toEqual([]);
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
