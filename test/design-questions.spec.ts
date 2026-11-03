import { expect, test } from "@playwright/test";

/**
 * Every sample of the question catalogue is its own question: radios and
 * ids never collide with another sample's, so each one keeps its own pick.
 */

test("design/questions gives every sample its own radio names and ids", async ({
	page,
}) => {
	const response = await page.goto("/design/questions");
	expect(response?.status()).toBe(200);
	await expect(page.locator("astro-island[ssr]")).toHaveCount(0);

	const { sharedNames, duplicateIds } = await page.evaluate(() => {
		const fieldsetsByName = new Map<string, Set<Element>>();
		for (const radio of document.querySelectorAll<HTMLInputElement>(
			'input[type="radio"]',
		)) {
			const owner = radio.closest("fieldset") ?? radio;
			const owners = fieldsetsByName.get(radio.name) ?? new Set();
			owners.add(owner);
			fieldsetsByName.set(radio.name, owners);
		}
		const counts = new Map<string, number>();
		for (const element of document.querySelectorAll("[id]")) {
			counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
		}
		return {
			sharedNames: [...fieldsetsByName]
				.filter(([, owners]) => owners.size > 1)
				.map(([name]) => name),
			duplicateIds: [...counts]
				.filter(([, count]) => count > 1)
				.map(([id]) => id),
		};
	});
	expect(sharedNames).toEqual([]);
	expect(duplicateIds).toEqual([]);
});

test("design/questions shows the pick of every readonly and review multiple-choice sample", async ({
	page,
}) => {
	await page.goto("/design/questions");
	const section = page.locator("section#multiple-choice");
	const samples = section.locator(
		'.mdq-question[data-mode="readonly"], .mdq-question[data-mode="review"]',
	);
	await expect(samples).toHaveCount(4);
	for (const sample of await samples.all()) {
		await expect(sample.locator('input[type="radio"]:checked')).toHaveCount(1);
	}
});
