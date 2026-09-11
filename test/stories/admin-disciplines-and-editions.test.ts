import { expect, test } from "@playwright/test";
import { disciplineService } from "@/db/services/discipline.service";
import { disciplineFactory } from "@/fixtures/discipline.factory";
import { fillField, logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("admin: create a discipline", async ({ page }) => {
	// Arrange: an admin exists. Nothing else is background — the discipline is
	// what the story creates.
	const admin = await seedUser({ role: "ADMIN", name: "Grace Admin" });
	const { slug } = disciplineFactory.build();

	await logInAs(page, admin);

	await test.step("admin opens the disciplines catalog", async () => {
		await page.goto("/admin/disciplines");
		await expect(
			page.getByRole("heading", { name: "Disciplines", level: 1 }),
		).toBeVisible();
	});

	await test.step("and registers a new subject", async () => {
		await fillField(page, "Slug", slug);
		await fillField(page, "Name", "Quantum Mechanics");
		await page.getByRole("button", { name: "New discipline" }).click();
	});

	await test.step("the catalog confirms it and lists it with no courses yet", async () => {
		await expect(
			page
				.getByRole("alert")
				.filter({ hasText: `Discipline "${slug}" created.` }),
		).toBeVisible();

		const row = page.getByRole("row").filter({ hasText: slug });
		await expect(row).toContainText("Quantum Mechanics");
		await expect(row).toContainText("0 courses");
	});

	// The story says the discipline outlives the courses under it, so the slug
	// has to have actually landed — not just been echoed back into the page.
	const stored = await disciplineService.findOne({ slug });
	expect(stored?.name).toBe("Quantum Mechanics");
});
