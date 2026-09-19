import { expect, test } from "@playwright/test";
import type { Actor } from "@/auth/actor";
import { FULL_ACCESS } from "@/auth/actor";
import type { UserId } from "@/core/schemas";
import { db } from "@/db";

function actorOf(
	username: UserId,
	role: "ADMIN" | "INSTRUCTOR" | "STUDENT",
): Actor {
	return { username, role } as unknown as Actor;
}

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
	return db.user.create(
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
	await db.discipline.create({ slug, name: slug }, FULL_ACCESS);
	return slug;
}

test("create() rejects a malformed slug", async () => {
	for (const slug of ["26-1", "2026-01", "2026-1-1", "2026 1", "spring"]) {
		await expect(
			db.edition.create({ slug, name: slug, ...WINDOW }, FULL_ACCESS),
		).rejects.toThrow();
	}
});

test("create() accepts a bare year and a year with a term", async () => {
	const bare = await db.edition.create(
		{ slug: "2101", name: "2101", ...WINDOW },
		FULL_ACCESS,
	);
	expect(bare.slug).toBe("2101");

	const withTerm = await db.edition.create(
		{ slug: "2101-2", name: "2101 · second term", ...WINDOW },
		FULL_ACCESS,
	);
	expect(withTerm.name).toBe("2101 · second term");
});

test("create() rejects an instructor and accepts an admin", async () => {
	await expect(
		db.edition.create(
			{ slug: "2102", name: "2102", ...WINDOW },
			{
				actor: actorOf("instructor" as UserId, "INSTRUCTOR"),
			},
		),
	).rejects.toThrow();

	const edition = await db.edition.create(
		{ slug: "2102", name: "2102", ...WINDOW },
		{ actor: actorOf("admin" as UserId, "ADMIN") },
	);
	expect(edition.slug).toBe("2102");
});

test("create() rejects a window that ends before it starts", async () => {
	await expect(
		db.edition.create(
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
	await db.edition.create(
		{ slug: "2104", name: "2104", ...WINDOW },
		FULL_ACCESS,
	);

	await expect(
		db.edition.update(
			{ slug: "2104" },
			{ name: "nope" },
			{
				actor: actorOf("instructor" as UserId, "INSTRUCTOR"),
			},
		),
	).rejects.toThrow();

	const updated = await db.edition.update(
		{ slug: "2104" },
		{ name: "2104 · renamed", endAt: new Date("2026-06-30") },
		FULL_ACCESS,
	);
	expect(updated.name).toBe("2104 · renamed");
	expect(updated.endAt).toEqual(new Date("2026-06-30"));
});

test("delete() refuses while a course uses the edition, and succeeds once it is gone", async () => {
	const slug = "2105";
	await db.edition.create({ slug, name: slug, ...openWindow() }, FULL_ACCESS);
	const instructor = await makeInstructor();
	const course = await db.course.create(
		{
			discipline: await makeDiscipline(),
			instructor: instructor.username,
			edition: slug,
			startAt: new Date(),
			endAt: new Date(),
		},
		FULL_ACCESS,
	);

	await expect(db.edition.delete({ slug }, FULL_ACCESS)).rejects.toThrow(
		/still has 1 course/,
	);

	await db.course.delete({ id: course.id }, FULL_ACCESS);
	await db.edition.delete({ slug }, FULL_ACCESS);
	expect(await db.edition.findOne({ slug })).toBeNull();
});

test("findMany({ active: true }) returns only editions whose window contains now", async () => {
	await db.edition.create(
		{ slug: "2106", name: "closed", ...WINDOW },
		FULL_ACCESS,
	);
	await db.edition.create(
		{ slug: "2107", name: "open", ...openWindow() },
		FULL_ACCESS,
	);

	const active = await db.edition.findMany({ active: true });
	const slugs = active.map((e) => e.slug);
	expect(slugs).toContain("2107");
	expect(slugs).not.toContain("2106");
});

test("db.course.create() enforces the window for instructors but not for admins", async () => {
	const slug = "2108";
	await db.edition.create(
		{ slug, name: "closed term", ...WINDOW },
		FULL_ACCESS,
	);
	const instructor = await makeInstructor();
	const disciplineSlug = await makeDiscipline();

	await expect(
		db.course.create(
			{
				discipline: disciplineSlug,
				instructor: instructor.username,
				edition: slug,
				startAt: new Date(),
				endAt: new Date(),
			},
			{ actor: actorOf(instructor.username, "INSTRUCTOR") },
		),
	).rejects.toThrow(/not accepting new courses/);

	const course = await db.course.create(
		{
			discipline: disciplineSlug,
			instructor: instructor.username,
			edition: slug,
			startAt: new Date(),
			endAt: new Date(),
		},
		{ actor: actorOf("admin" as UserId, "ADMIN") },
	);
	expect(course.edition.slug).toBe(slug);
});

test("upsert creates on first call, updates the same row in place on the second, and a different slug creates a separate row", async () => {
	const created = await db.edition.upsert(
		{ slug: "2201-1", name: "Before", ...WINDOW },
		FULL_ACCESS,
	);
	expect(created.slug).toBe("2201-1");
	expect(created.name).toBe("Before");

	const newEndAt = new Date("2026-06-30");
	const updated = await db.edition.upsert(
		{ slug: "2201-1", name: "After", startAt: WINDOW.startAt, endAt: newEndAt },
		FULL_ACCESS,
	);
	expect(updated.name).toBe("After"); // changed
	expect(updated.endAt).toEqual(newEndAt); // changed
	expect(updated.startAt).toEqual(WINDOW.startAt); // untouched

	const sameSlug = await db.edition.findMany({ slugs: ["2201-1"] });
	expect(sameSlug).toHaveLength(1);

	const other = await db.edition.upsert(
		{ slug: "2201-2", name: "Other", ...WINDOW },
		FULL_ACCESS,
	);
	expect(other.slug).toBe("2201-2");
	const both = await db.edition.findMany({ slugs: ["2201-1", "2201-2"] });
	expect(both).toHaveLength(2);
});
