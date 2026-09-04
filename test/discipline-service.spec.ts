import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { courseService } from "@/db/services/course.service";
import { disciplineService } from "@/db/services/discipline.service";
import { editionService } from "@/db/services/edition.service";
import { userService } from "@/db/services/user.service";

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

test("findOne() returns a discipline by slug, or null", async () => {
	await disciplineService.create(
		{ slug: "disc-findone", name: "Find One" },
		FULL_ACCESS,
	);
	expect(
		(await disciplineService.findOne({ slug: "disc-findone" }))?.name,
	).toBe("Find One");
	expect(await disciplineService.findOne({ slug: "disc-missing" })).toBeNull();
});

test("update() renames a discipline and refuses a non-admin", async () => {
	await disciplineService.create(
		{ slug: "disc-rename", name: "Before" },
		FULL_ACCESS,
	);

	await expect(
		disciplineService.update(
			{ slug: "disc-rename" },
			{ name: "Nope" },
			{
				actor: { id: 1, role: "INSTRUCTOR" },
			},
		),
	).rejects.toThrow();

	const updated = await disciplineService.update(
		{ slug: "disc-rename" },
		{ name: "After" },
		FULL_ACCESS,
	);
	expect(updated.name).toBe("After");
	expect(updated.slug).toBe("disc-rename");
});

test("delete() refuses while a course uses the discipline, and succeeds once it does not", async () => {
	const slug = "disc-delete";
	await disciplineService.create({ slug, name: "Deletable" }, FULL_ACCESS);
	await editionService.create(
		{
			slug: "2201",
			name: "2201",
			startAt: new Date(Date.now() - 86_400_000),
			endAt: new Date(Date.now() + 86_400_000),
		},
		FULL_ACCESS,
	);
	const instructor = await userService.create(
		{
			email: "disc-delete@codehood.test",
			username: "disc-delete-instructor",
			name: "Instructor",
			role: "INSTRUCTOR",
			password: "x",
			githubId: "disc-delete-instructor",
			schoolId: "disc-delete-instructor",
		},
		FULL_ACCESS,
	);
	const course = await courseService.create(
		{
			disciplineSlug: slug,
			instructorUsername: instructor.username,
			editionSlug: "2201",
			startAt: new Date(),
			endAt: new Date(),
		},
		FULL_ACCESS,
	);

	await expect(disciplineService.delete({ slug }, FULL_ACCESS)).rejects.toThrow(
		/still has 1 course/,
	);

	await courseService.delete({ id: course.id }, FULL_ACCESS);
	await disciplineService.delete({ slug }, FULL_ACCESS);
	expect(await disciplineService.findOne({ slug })).toBeNull();
});
