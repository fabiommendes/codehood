import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

let uniq = 0;
function tag(prefix: string): string {
	uniq += 1;
	return `${prefix}${uniq}`;
}

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	// Prefixed "pp" (passphrase) so these usernames can't collide with
	// another spec file's own tag()-generated fixtures sharing the same DB.
	const username = tag(`pp-${role.toLowerCase()}`);
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: "x",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function ensureEdition(slug = "2026-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

async function makeCourse(instructorUsername: string) {
	await ensureEdition();
	// "pp-disc" rather than "disc" — course-service.spec.ts's own tag() runs an
	// independent counter over the same literal "disc" prefix, and the two
	// collide on a shared test database once both reach the same number.
	const slug = tag("pp-disc");
	await db.discipline.create({ slug, name: slug }, FULL_ACCESS);
	return db.course.create(
		{
			discipline: slug,
			instructor: instructorUsername,
			edition: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

test("create() auto-generates a 6-character code that expires 5 minutes out", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);

	const before = Date.now();
	const passphrase = await db.passphrase.create(
		{ courseId: course.id },
		{ actor: instructor },
	);

	expect(passphrase.value).toMatch(/^[A-Z2-9]{6}$/);
	const ttlMs = passphrase.expiresAt.getTime() - before;
	expect(ttlMs).toBeGreaterThan(4.9 * 60 * 1000);
	expect(ttlMs).toBeLessThan(5.1 * 60 * 1000);
});

test("create() accepts an instructor's own override, and refuses one already in use", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);

	const passphrase = await db.passphrase.create(
		{ courseId: course.id, value: "PIZZA1" },
		{ actor: instructor },
	);
	expect(passphrase.value).toBe("PIZZA1");

	await expect(
		db.passphrase.create(
			{ courseId: course.id, value: "PIZZA1" },
			{ actor: instructor },
		),
	).rejects.toThrow(/already in use/);
});

test("create() throws FORBIDDEN for a student and for an instructor who does not teach the course", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const otherInstructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	for (const actor of [student, otherInstructor]) {
		await expect(
			db.passphrase.create({ courseId: course.id }, { actor }),
		).rejects.toThrow();
	}
});

test("a non-owning admin cannot generate, list, update, or delete a course's passphrase", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const course = await makeCourse(instructor.username);
	const passphrase = await db.passphrase.create(
		{ courseId: course.id },
		{ actor: instructor },
	);

	await expect(
		db.passphrase.create({ courseId: course.id }, { actor: admin }),
	).rejects.toThrow();
	await expect(
		db.passphrase.findMany({ courseId: course.id }, { actor: admin }),
	).rejects.toThrow();
	await expect(
		db.passphrase.update(
			{ id: passphrase.id },
			{ expiresAt: new Date() },
			{ actor: admin },
		),
	).rejects.toThrow();
	await expect(
		db.passphrase.delete({ id: passphrase.id }, { actor: admin }),
	).rejects.toThrow();
});

test("findOne({ value }) is not actor-filtered — the value itself is the credential", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const student = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);
	const passphrase = await db.passphrase.create(
		{ courseId: course.id, value: "OPEN99" },
		{ actor: instructor },
	);

	const found = await db.passphrase.findOne(
		{ value: "OPEN99" },
		{ actor: student },
	);
	expect(found?.id).toBe(passphrase.id);
});

test("the owning instructor can extend expiry and revoke early", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const passphrase = await db.passphrase.create(
		{ courseId: course.id },
		{ actor: instructor },
	);

	const laterExpiry = new Date(Date.now() + 60 * 60 * 1000);
	const updated = await db.passphrase.update(
		{ id: passphrase.id },
		{ expiresAt: laterExpiry },
		{ actor: instructor },
	);
	expect(updated.expiresAt.getTime()).toBe(laterExpiry.getTime());

	await db.passphrase.delete({ id: passphrase.id }, { actor: instructor });
	await expect(
		db.passphrase.findOne({ id: passphrase.id }, { actor: instructor }),
	).resolves.toBeNull();
});
