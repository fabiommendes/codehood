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

test("no-JS path: the page re-render receives an input error for the slug", async ({
	page,
}) => {
	const admin = await seedUser({ role: "ADMIN" });
	const existing = await persistedDisciplineFactory.create();
	await logInAs(page, admin);
	await page.goto("/admin/disciplines");
	await fillField(page, "Slug", existing.slug);
	await fillField(page, "Name", "Another name");
	await page.getByRole("button", { name: "New discipline" }).click();

	// Until the page renders field errors, the only observable trace is the
	// message Astro builds for an input error (a JSON dump of the issues),
	// which a plain ActionError never has.
	const alert = page.getByRole("alert").first();
	await expect(alert).toContainText("Failed to validate");
	await expect(alert).toContainText("is already taken.");
	await expect(alert).toContainText('"slug"');
});
