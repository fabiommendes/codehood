import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/db/base-service";
import { courseService } from "@/db/course.service";
import { disciplineService } from "@/db/discipline.service";
import { editionService } from "@/db/edition.service";
import { userService } from "@/db/user.service";

let uniq = 0;
function tag(prefix: string): string {
	uniq += 1;
	return `${prefix}${uniq}`;
}

const WINDOW = {
	startAt: new Date("2026-01-05"),
	endAt: new Date("2026-05-15"),
};

/** A window that contains now, so a course may be created in it. */
function openWindow() {
	const now = Date.now();
	return {
		startAt: new Date(now - 86_400_000),
		endAt: new Date(now + 86_400_000),
	};
}

async function makeInstructor() {
	const username = tag("edition-instructor");
	return userService.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role: "INSTRUCTOR",
			password: "x",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function makeDiscipline() {
	const slug = tag("edition-disc");
	await disciplineService.create({ slug, name: slug }, FULL_ACCESS);
	return slug;
}

test("create() rejects a malformed slug", async () => {
	for (const slug of ["26-1", "2026-01", "2026-1-1", "2026 1", "spring"]) {
		await expect(
			editionService.create({ slug, name: slug, ...WINDOW }, FULL_ACCESS),
		).rejects.toThrow();
	}
});

test("create() accepts a bare year and a year with a term", async () => {
	const bare = await editionService.create(
		{ slug: "2101", name: "2101", ...WINDOW },
		FULL_ACCESS,
	);
	expect(bare.slug).toBe("2101");

	const withTerm = await editionService.create(
		{ slug: "2101-2", name: "2101 · second term", ...WINDOW },
		FULL_ACCESS,
	);
	expect(withTerm.name).toBe("2101 · second term");
});

test("create() rejects an instructor and accepts an admin", async () => {
	await expect(
		editionService.create(
			{ slug: "2102", name: "2102", ...WINDOW },
			{
				actor: { id: 1, role: "INSTRUCTOR" },
			},
		),
	).rejects.toThrow();

	const edition = await editionService.create(
		{ slug: "2102", name: "2102", ...WINDOW },
		{ actor: { id: 1, role: "ADMIN" } },
	);
	expect(edition.slug).toBe("2102");
});

test("create() rejects a window that ends before it starts", async () => {
	await expect(
		editionService.create(
			{
				slug: "2103",
				name: "2103",
				startAt: new Date("2026-05-15"),
				endAt: new Date("2026-01-05"),
			},
			FULL_ACCESS,
		),
	).rejects.toThrow();
});

test("update() changes name and window, and needs an admin", async () => {
	await editionService.create(
		{ slug: "2104", name: "2104", ...WINDOW },
		FULL_ACCESS,
	);

	await expect(
		editionService.update(
			{ slug: "2104" },
			{ name: "nope" },
			{
				actor: { id: 1, role: "INSTRUCTOR" },
			},
		),
	).rejects.toThrow();

	const updated = await editionService.update(
		{ slug: "2104" },
		{ name: "2104 · renamed", endAt: new Date("2026-06-30") },
		FULL_ACCESS,
	);
	expect(updated.name).toBe("2104 · renamed");
	expect(updated.endAt).toEqual(new Date("2026-06-30"));
});

test("delete() refuses while a course uses the edition, and succeeds once it is gone", async () => {
	const slug = "2105";
	await editionService.create(
		{ slug, name: slug, ...openWindow() },
		FULL_ACCESS,
	);
	const instructor = await makeInstructor();
	const course = await courseService.create(
		{
			disciplineSlug: await makeDiscipline(),
			instructorUsername: instructor.username,
			editionSlug: slug,
			startAt: new Date(),
			endAt: new Date(),
		},
		FULL_ACCESS,
	);

	await expect(editionService.delete({ slug }, FULL_ACCESS)).rejects.toThrow(
		/still has 1 course/,
	);

	await courseService.delete({ id: course.id }, FULL_ACCESS);
	await editionService.delete({ slug }, FULL_ACCESS);
	expect(await editionService.findOne({ slug })).toBeNull();
});

test("findMany({ active: true }) returns only editions whose window contains now", async () => {
	await editionService.create(
		{ slug: "2106", name: "closed", ...WINDOW },
		FULL_ACCESS,
	);
	await editionService.create(
		{ slug: "2107", name: "open", ...openWindow() },
		FULL_ACCESS,
	);

	const active = await editionService.findMany({ active: true });
	const slugs = active.map((e) => e.slug);
	expect(slugs).toContain("2107");
	expect(slugs).not.toContain("2106");
});

test("courseService.create() enforces the window for instructors but not for admins", async () => {
	const slug = "2108";
	await editionService.create(
		{ slug, name: "closed term", ...WINDOW },
		FULL_ACCESS,
	);
	const instructor = await makeInstructor();
	const disciplineSlug = await makeDiscipline();

	await expect(
		courseService.create(
			{
				disciplineSlug,
				instructorUsername: instructor.username,
				editionSlug: slug,
				startAt: new Date(),
				endAt: new Date(),
			},
			{ actor: { id: instructor.id, role: "INSTRUCTOR" } },
		),
	).rejects.toThrow(/not accepting new courses/);

	const course = await courseService.create(
		{
			disciplineSlug,
			instructorUsername: instructor.username,
			editionSlug: slug,
			startAt: new Date(),
			endAt: new Date(),
		},
		{ actor: { id: 1, role: "ADMIN" } },
	);
	expect(course.editionSlug).toBe(slug);
});
