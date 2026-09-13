import { expect, test } from "@playwright/test";
import { resetDatabase } from "./helpers";

test.beforeEach(resetDatabase);

test("admin: check that the instance is healthy", async ({ request }) => {
	// No session, no cookie, no API key — an uptime monitor holds none of those.
	const response = await request.get("/api/health");

	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({ status: "ok", database: "ok" });
});

test("admin: read the api documentation", async ({ page }) => {
	await page.goto("/api/docs");

	// Swagger UI renders the spec's own `info.title`, so this is proof the
	// page actually loaded `/openapi.json` rather than showing a blank shell.
	await expect(
		page.getByRole("heading", { name: "Codehood API" }),
	).toBeVisible();

	// The generated docs list the real routes the server answers to — pick one
	// that exists nowhere else in this catalogue's "implemented" set, so a
	// stale, hand-written page couldn't accidentally pass this.
	await expect(page.getByText("/api/health").first()).toBeVisible();
});
