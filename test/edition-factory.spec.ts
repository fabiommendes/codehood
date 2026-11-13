import { faker } from "@faker-js/faker";
import { expect, test } from "@playwright/test";
import { persistedEditionFactory } from "@/fixtures/edition.factory";

test("a random edition slug that is already taken is redrawn", async () => {
	const taken = await persistedEditionFactory.create();
	const [year, term] = taken.slug.split("-").map(Number) as [number, number];

	// The first draw repeats the taken slug; later draws are random again.
	// Only the slug draws are forced: faker's dates draw numbers too.
	const original = faker.number.int.bind(faker.number);
	const forced = new Map([
		[1000, year],
		[1, term],
	]);
	faker.number.int = ((options?: Parameters<typeof original>[0]) => {
		const min = typeof options === "object" ? options.min : undefined;
		const max = typeof options === "object" ? options.max : undefined;
		const slugDraw =
			(min === 1000 && max === 9999) || (min === 1 && max === 99);
		const value = slugDraw ? forced.get(min as number) : undefined;
		if (value === undefined) return original(options);
		forced.delete(min as number);
		return value;
	}) as typeof faker.number.int;
	try {
		const edition = await persistedEditionFactory.create();
		expect(forced.size).toBe(0);
		expect(edition.slug).not.toBe(taken.slug);
	} finally {
		faker.number.int = original;
	}
});
