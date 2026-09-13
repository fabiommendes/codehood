import { expect, test } from "@playwright/test";
import type { Actor } from "@/core/actor";
import { FULL_ACCESS } from "@/core/actor";
import type { UserId } from "@/core/schemas";
import { courseService } from "@/db/services/course.service";
import { disciplineService } from "@/db/services/discipline.service";
import { editionService } from "@/db/services/edition.service";
import { userService } from "@/db/services/user.service";

function actorOf(
	username: UserId,
	role: "ADMIN" | "INSTRUCTOR" | "STUDENT",
): Actor {
	return { id: username, role } as unknown as Actor;
}

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
			{ actor: actorOf("instructor" as UserId, "INSTRUCTOR") },
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
				actor: actorOf("instructor" as UserId, "INSTRUCTOR"),
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
			discipline: slug,
			instructor: instructor.username,
			edition: "2201",
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

test("upsert creates on first call, updates the same row in place on the second, and a different slug creates a separate row", async () => {
	const created = await disciplineService.upsert(
		{ slug: "disc-upsert", name: "Before" },
		FULL_ACCESS,
	);
	expect(created.slug).toBe("disc-upsert");
	expect(created.name).toBe("Before");

	const updated = await disciplineService.upsert(
		{ slug: "disc-upsert", name: "After" },
		FULL_ACCESS,
	);
	expect(updated.slug).toBe("disc-upsert"); // same key, same row
	expect(updated.name).toBe("After"); // changed

	const sameSlug = await disciplineService.findMany({ slugs: ["disc-upsert"] });
	expect(sameSlug).toHaveLength(1);

	const other = await disciplineService.upsert(
		{ slug: "disc-upsert-2", name: "Other" },
		FULL_ACCESS,
	);
	expect(other.slug).toBe("disc-upsert-2");
	const both = await disciplineService.findMany({
		slugs: ["disc-upsert", "disc-upsert-2"],
	});
	expect(both).toHaveLength(2);
});
