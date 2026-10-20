import { expect, type Locator, type Page, test } from "@playwright/test";
import { db } from "@/db";
import { persistedDisciplineFactory } from "@/fixtures/discipline.factory";
import {
	editionFactory,
	persistedEditionFactory,
} from "@/fixtures/edition.factory";
import { fillField, logInAs, seedUser } from "./stories/helpers";

/**
 * The admin forms show each error under the field it belongs to, whether the
 * schema or a service raised it. No `resetDatabase`: it also wipes the dev
 * accounts the API specs log in with, so every row here is unique per run.
 */

/// The fieldset of `label` inside `scope`.
const group = (scope: Page | Locator, label: string) =>
	scope.getByRole("group", { name: label, exact: true });

/// A browser stops a form with an empty `required` field before it posts, so
/// the tests that need the server's answer switch the native check off.
async function submit(page: Page, form: Locator, button: Locator) {
	await form.evaluate((element: HTMLFormElement) => {
		element.noValidate = true;
	});
	await button.click();
	await expect(page.getByText("Failed to validate")).toHaveCount(0);
}

test.describe("edition form", () => {
	async function open(page: Page) {
		const admin = await seedUser({ role: "ADMIN" });
		await logInAs(page, admin);
		await page.goto("/admin/editions");
		const button = page.getByRole("button", { name: "New edition" });
		const form = page.locator("form").filter({ has: button });
		return { form, button };
	}

	test("an empty start date reads Required and creates nothing", async ({
		page,
	}) => {
		const { form, button } = await open(page);
		const { slug } = editionFactory.build();
		await fillField(page, "Slug", slug);
		await fillField(page, "Name", "Some term");
		await group(page, "Ends").locator("input").fill("2026-12-15");
		await submit(page, form, button);

		await expect(group(page, "Starts")).toContainText("Required");
		await expect(group(page, "Ends")).not.toContainText("Required");
		// What was typed comes back.
		await expect(group(page, "Name").locator("input")).toHaveValue("Some term");
		expect(await db.edition.findOne({ slug })).toBeNull();
	});

	test("an end date before the start is refused on the end date", async ({
		page,
	}) => {
		const { form, button } = await open(page);
		const { slug } = editionFactory.build();
		await fillField(page, "Slug", slug);
		await fillField(page, "Name", "Backwards");
		await group(page, "Starts").locator("input").fill("2026-12-15");
		await group(page, "Ends").locator("input").fill("2026-08-01");
		await submit(page, form, button);

		await expect(group(page, "Ends")).toContainText(
			"Must be after the start date.",
		);
		expect(await db.edition.findOne({ slug })).toBeNull();
	});

	test("a malformed slug is refused on the slug", async ({ page }) => {
		const { form, button } = await open(page);
		await fillField(page, "Slug", "spring");
		await fillField(page, "Name", "Spring");
		await group(page, "Starts").locator("input").fill("2026-08-01");
		await group(page, "Ends").locator("input").fill("2026-12-15");
		await submit(page, form, button);

		await expect(group(page, "Slug")).toContainText("Use a year");
	});

	test("a taken slug is refused on the slug", async ({ page }) => {
		const { form, button } = await open(page);
		const existing = await persistedEditionFactory.create();
		await fillField(page, "Slug", existing.slug);
		await fillField(page, "Name", "Again");
		await group(page, "Starts").locator("input").fill("2026-08-01");
		await group(page, "Ends").locator("input").fill("2026-12-15");
		await submit(page, form, button);

		await expect(group(page, "Slug")).toContainText(
			`Slug "${existing.slug}" is already taken.`,
		);
	});

	test("the edit dialog reopens with the error under the field", async ({
		page,
	}) => {
		const { form: _form } = await open(page);
		const edition = await persistedEditionFactory.create();
		await page.goto("/admin/editions");
		await page
			.getByRole("button", { name: `Edit ${edition.slug}`, exact: true })
			.click();
		const dialog = page.locator(`#edit-edition-${edition.slug}`);
		await group(dialog, "Starts").locator("input").fill("");
		await submit(
			page,
			dialog.locator("form[action*='updateEdition']"),
			dialog.getByRole("button", { name: "Save" }),
		);

		await expect(dialog).toBeVisible();
		await expect(group(dialog, "Starts")).toContainText("Required");
		const stored = await db.edition.findOne({ slug: edition.slug });
		expect(stored?.startAt.getTime()).toBe(edition.startAt.getTime());
	});
});

test.describe("add user form", () => {
	async function open(page: Page) {
		const admin = await seedUser({ role: "ADMIN" });
		await logInAs(page, admin);
		await page.goto("/admin/users");
		await page.getByRole("button", { name: "Add new user" }).click();
		const dialog = page.locator("#add-user-dialog");
		return { admin, dialog };
	}

	async function fillUser(
		dialog: Locator,
		values: Record<string, string>,
	): Promise<void> {
		for (const [label, value] of Object.entries(values)) {
			await group(dialog, label).locator("input").fill(value);
		}
	}

	test("a taken username and email are refused on their own fields", async ({
		page,
	}) => {
		const { dialog } = await open(page);
		const taken = await seedUser({ role: "STUDENT" });
		await fillUser(dialog, {
			Name: "Someone",
			Email: "fresh@codehood.test",
			Username: taken.username,
			"GitHub id": `gh-${taken.username}`,
			"School id": `sc-${taken.username}`,
			Password: "correcthorse",
		});
		await submit(
			page,
			dialog.locator("form[action*='createUser']"),
			dialog.getByRole("button", { name: "Add user" }),
		);

		await expect(dialog).toBeVisible();
		await expect(group(dialog, "Username")).toContainText("already exists");
		await expect(group(dialog, "Email")).not.toContainText("already exists");
		// The password is never sent back.
		await expect(group(dialog, "Password").locator("input")).toHaveValue("");

		await fillUser(dialog, {
			Email: taken.email,
			Username: "someone-else",
			Password: "correcthorse",
		});
		await submit(
			page,
			dialog.locator("form[action*='createUser']"),
			dialog.getByRole("button", { name: "Add user" }),
		);
		await expect(group(dialog, "Email")).toContainText("already exists");
	});

	test("a student without GitHub id and school id is refused on those fields", async ({
		page,
	}) => {
		const { dialog } = await open(page);
		const suffix = Date.now().toString(36);
		await fillUser(dialog, {
			Name: "Student",
			Email: `student-${suffix}@codehood.test`,
			Username: `student-${suffix}`,
			Password: "correcthorse",
		});
		await submit(
			page,
			dialog.locator("form[action*='createUser']"),
			dialog.getByRole("button", { name: "Add user" }),
		);

		await expect(group(dialog, "GitHub id")).toContainText(
			"Required for students.",
		);
	});

	test("a short password and a bad email are refused on their own fields", async ({
		page,
	}) => {
		const { dialog } = await open(page);
		await fillUser(dialog, {
			Name: "Someone",
			Email: "not-an-email",
			Username: "someone",
			Password: "short",
		});
		await submit(
			page,
			dialog.locator("form[action*='createUser']"),
			dialog.getByRole("button", { name: "Add user" }),
		);

		await expect(group(dialog, "Email")).toContainText("valid email");
		await expect(group(dialog, "Password")).toContainText("at least 8");
	});
});

test("invite form: a bad email is refused on the email field", async ({
	page,
}) => {
	const admin = await seedUser({ role: "ADMIN" });
	await logInAs(page, admin);
	await page.goto("/admin");
	await page.getByRole("button", { name: "Invite instructor" }).click();
	const dialog = page.locator("#invite-instructor-dialog");
	await group(dialog, "Email").locator("input").fill("nope");
	await submit(
		page,
		dialog.locator("form[action*='inviteInstructor']"),
		dialog.getByRole("button", { name: "Generate invite link" }),
	);

	await expect(dialog).toBeVisible();
	await expect(group(dialog, "Email")).toContainText("valid email");
});

test("discipline edit dialog: an empty name is refused on the name", async ({
	page,
}) => {
	const admin = await seedUser({ role: "ADMIN" });
	const discipline = await persistedDisciplineFactory.create();
	await logInAs(page, admin);
	await page.goto("/admin/disciplines");
	await page
		.getByRole("button", { name: `Edit ${discipline.slug}`, exact: true })
		.click();
	const dialog = page.locator(`#edit-discipline-${discipline.slug}`);
	await group(dialog, "Name").locator("input").fill("");
	await submit(
		page,
		dialog.locator("form[action*='updateDiscipline']"),
		dialog.getByRole("button", { name: "Save" }),
	);

	await expect(dialog).toBeVisible();
	await expect(group(dialog, "Name")).toContainText("Required");
	expect((await db.discipline.findOne({ slug: discipline.slug }))?.name).toBe(
		discipline.name,
	);
});
