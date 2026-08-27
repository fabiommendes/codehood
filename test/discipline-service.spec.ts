import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/db/base-service";
import { disciplineService } from "@/db/discipline.service";

test("create() rejects a reserved slug", async () => {
	await expect(
		disciplineService.create({ slug: "login", name: "Login" }, FULL_ACCESS),
	).rejects.toThrow();
	await expect(
		disciplineService.create({ slug: "design", name: "Design" }, FULL_ACCESS),
	).rejects.toThrow();
	await expect(
		disciplineService.create({ slug: "api", name: "API" }, FULL_ACCESS),
	).rejects.toThrow();
});

test("create() accepts a well-formed slug", async () => {
	const discipline = await disciplineService.create(
		{ slug: "cs101-disc-test", name: "Intro to CS" },
		FULL_ACCESS,
	);
	expect(discipline.slug).toBe("cs101-disc-test");
});

test("create() rejects a non-admin, non-system actor", async () => {
	await expect(
		disciplineService.create(
			{ slug: "some-discipline", name: "Some Discipline" },
			{ actor: { id: 1, role: "INSTRUCTOR" } },
		),
	).rejects.toThrow();
});
