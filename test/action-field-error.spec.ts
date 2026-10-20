import { expect, test } from "@playwright/test";
import { persistedDisciplineFactory } from "@/fixtures/discipline.factory";
import { fillField, logInAs, seedUser } from "./stories/helpers";

/**
 * Contract test for `FieldError` (`src/core/error.ts`): `withServiceErrors`
 * makes it travel as an Astro input error. That relies on Astro internals
 * (`ActionInputError` is not exported), so this fails if they change.
 */

/// No `resetDatabase`: it also wipes the dev accounts that the API specs, which
/// run after this file, log in with. Every row here is unique per run instead.

async function adminToken(
	request: import("@playwright/test").APIRequestContext,
) {
	const admin = await seedUser({ role: "ADMIN" });
	const login = await request.post("/api/auth/login", {
		data: { login: admin.username, password: admin.password },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { admin, headers: { Authorization: `Bearer ${token}` } };
}

test("JS path: a schema error on the slug is an input error with fields.slug", async ({
	request,
}) => {
	const { headers } = await adminToken(request);
	const res = await request.post("/_actions/admin.createDiscipline", {
		headers,
		form: { slug: "Not Valid!", name: "Whatever" },
	});
	expect(res.status()).toBe(400);
	const body = await res.json();
	expect(body.type).toBe("AstroActionInputError");
	expect(body.fields.slug).toHaveLength(1);
});

test("JS path: a duplicate slug (FieldError from the service) is an input error with fields.slug", async ({
	request,
}) => {
	const { headers } = await adminToken(request);
	const existing = await persistedDisciplineFactory.create();
	const res = await request.post("/_actions/admin.createDiscipline", {
		headers,
		form: { slug: existing.slug, name: "Another name" },
	});
	expect(res.status()).toBe(400);
	const body = await res.json();
	expect(body.type).toBe("AstroActionInputError");
	expect(body.issues).toEqual([expect.objectContaining({ path: ["slug"] })]);
	expect(body.fields.slug).toEqual([
		`Slug "${existing.slug}" is already taken.`,
	]);
});

/// A browser stops a form with an empty `required` field before it posts, so
/// the tests that need the server's answer switch the native check off.
async function submitCreateDiscipline(
	page: import("@playwright/test").Page,
	slug: string,
	name: string,
) {
	await page.goto("/admin/disciplines");
	await fillField(page, "Slug", slug);
	await fillField(page, "Name", name);
	await page
		.locator("form")
		.filter({ has: page.getByRole("button", { name: "New discipline" }) })
		.evaluate((form: HTMLFormElement) => {
			form.noValidate = true;
		});
	await page.getByRole("button", { name: "New discipline" }).click();
}

test.describe("no-JS path: the page re-render shows the error in the field", () => {
	test.use({ javaScriptEnabled: false });

	test("a duplicate slug from the service", async ({ page }) => {
		const admin = await seedUser({ role: "ADMIN" });
		const existing = await persistedDisciplineFactory.create();
		await logInAs(page, admin);
		await submitCreateDiscipline(page, existing.slug, "Another name");

		const slug = page.getByRole("group", { name: "Slug", exact: true });
		await expect(slug).toContainText(
			`Slug "${existing.slug}" is already taken.`,
		);
		await expect(slug.locator("input")).toHaveAttribute("aria-invalid", "true");
		await expect(slug.locator("input")).toHaveValue(existing.slug);
		await expect(
			page.getByRole("group", { name: "Name", exact: true }).locator("input"),
		).toHaveValue("Another name");
		await expect(page.getByText("Failed to validate")).toHaveCount(0);
	});

	test("an invalid slug from the schema", async ({ page }) => {
		const admin = await seedUser({ role: "ADMIN" });
		await logInAs(page, admin);
		await submitCreateDiscipline(page, "Not Valid!", "Whatever");

		const slug = page.getByRole("group", { name: "Slug", exact: true });
		await expect(slug).toContainText(
			"Use lowercase letters, digits and hyphens",
		);
		await expect(page.getByText("Failed to validate")).toHaveCount(0);
	});

	test("an empty slug reads Required, not a type error", async ({ page }) => {
		const admin = await seedUser({ role: "ADMIN" });
		await logInAs(page, admin);
		await submitCreateDiscipline(page, "", "Whatever");

		const slug = page.getByRole("group", { name: "Slug", exact: true });
		await expect(slug).toContainText("Required");
		await expect(page.getByText("expected string")).toHaveCount(0);
		await expect(page.getByText("Failed to validate")).toHaveCount(0);
	});
});
