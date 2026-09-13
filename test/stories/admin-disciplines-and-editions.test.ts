import { expect, test } from "@playwright/test";
import { disciplineService } from "@/db/services/discipline.service";
import { editionService } from "@/db/services/edition.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import {
	disciplineFactory,
	persistedDisciplineFactory,
} from "@/fixtures/discipline.factory";
import {
	editionFactory,
	persistedEditionFactory,
} from "@/fixtures/edition.factory";
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

test("admin: create an edition", async ({ page }) => {
	const admin = await seedUser({ role: "ADMIN", name: "Grace Admin" });
	const { slug } = editionFactory.build();

	await logInAs(page, admin);
	await page.goto("/admin/editions");

	await test.step("admin opens a new academic term", async () => {
		await fillField(page, "Slug", slug);
		await fillField(page, "Name", "Second term");
		await page
			.getByRole("group", { name: "Starts" })
			.locator("input")
			.fill("2026-08-01");
		await page
			.getByRole("group", { name: "Ends" })
			.locator("input")
			.fill("2026-12-15");
		await page.getByRole("button", { name: "New edition" }).click();
	});

	await test.step("the term is confirmed and listed as live", async () => {
		await expect(
			page.getByRole("alert").filter({ hasText: `Edition "${slug}" created.` }),
		).toBeVisible();

		const row = page.getByRole("row").filter({ hasText: slug });
		await expect(row).toContainText("Second term");
		await expect(row).toContainText("0 courses");
	});

	// Instructors can only create courses inside the window the admin just
	// opened — that window is the part the page can't show back visually.
	const stored = await editionService.findOne({ slug });
	expect(stored?.startAt.toISOString().slice(0, 10)).toBe("2026-08-01");
	expect(stored?.endAt.toISOString().slice(0, 10)).toBe("2026-12-15");
});

test("admin: delete an edition or discipline created by mistake", async ({
	page,
}) => {
	const admin = await seedUser({ role: "ADMIN", name: "Grace Admin" });
	const empty = await persistedEditionFactory.create();
	const inUse = await persistedEditionFactory.create();
	await persistedCourseFactory.create({ edition: inUse.slug });
	const emptyDiscipline = await persistedDisciplineFactory.create();
	const disciplineInUse = await persistedDisciplineFactory.create();
	await persistedCourseFactory.create({ discipline: disciplineInUse.slug });

	await logInAs(page, admin);

	await test.step("an empty edition is removed outright", async () => {
		await page.goto("/admin/editions");
		await page
			.getByRole("row")
			.filter({ hasText: empty.slug })
			.getByRole("button", { name: `Delete ${empty.slug}` })
			.click();
		await expect(page.getByText("Edition deleted.")).toBeVisible();
		await expect(
			page.getByRole("row").filter({ hasText: empty.slug }),
		).toHaveCount(0);
	});

	await test.step("one with courses hanging off it is not silently destroyed", async () => {
		const row = page.getByRole("row").filter({ hasText: inUse.slug });
		await expect(
			row.getByRole("button", { name: `Delete ${inUse.slug}` }),
		).toBeDisabled();
	});

	await test.step("the same protection applies to disciplines", async () => {
		await page.goto("/admin/disciplines");
		await page
			.getByRole("row")
			.filter({ hasText: emptyDiscipline.slug })
			.getByRole("button", { name: `Delete ${emptyDiscipline.slug}` })
			.click();
		await expect(
			page.getByRole("row").filter({ hasText: emptyDiscipline.slug }),
		).toHaveCount(0);

		const row = page.getByRole("row").filter({ hasText: disciplineInUse.slug });
		await expect(
			row.getByRole("button", { name: `Delete ${disciplineInUse.slug}` }),
		).toBeDisabled();
	});

	// The courses running under the surviving ones are untouched.
	expect(await editionService.findOne({ slug: inUse.slug })).not.toBeNull();
	expect(
		await disciplineService.findOne({ slug: disciplineInUse.slug }),
	).not.toBeNull();
	expect(await editionService.findOne({ slug: empty.slug })).toBeNull();
});
