import { expect, test } from "@playwright/test";
import type { Actor } from "@/auth/actor";
import { FULL_ACCESS } from "@/auth/actor";
import { verifyPassword } from "@/auth/password";
import { hasPerm } from "@/auth/permissions";
import type { UserId } from "@/core/schemas";
import { db } from "@/db";

function actorOf(
	username: UserId,
	role: "ADMIN" | "INSTRUCTOR" | "STUDENT",
): Actor {
	return { username, role } as unknown as Actor;
}

test("admin without githubId/schoolId has them null, not the sentinel", async () => {
	const user = await db.user.create(
		{
			email: "root@codehood.test",
			username: "sysop",
			name: "Root",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);
	expect(user.githubId).toBeNull();
	expect(user.schoolId).toBeNull();
});

test("student requires githubId and schoolId", async () => {
	await expect(
		db.user.create(
			{
				email: "s1@codehood.test",
				username: "s1",
				name: "S1",
				role: "STUDENT",
				password: "x",
			},
			FULL_ACCESS,
		),
	).rejects.toThrow();
});

test("update() rejects any attempt to smuggle in a username change", async () => {
	const user = await db.user.create(
		{
			email: "immutable-username@codehood.test",
			username: "immutable-username",
			name: "Immutable Username",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);

	const fieldsWithSmuggledUsername = {
		name: user.name,
		email: user.email,
		githubId: user.githubId,
		schoolId: user.schoolId,
		username: "renamed",
		// biome-ignore lint/suspicious/noExplicitAny: UpdateProfile has no username field by design; this simulates a caller bypassing the type.
	} as any;

	await expect(
		db.user.update(
			{ username: user.username },
			fieldsWithSmuggledUsername,
			FULL_ACCESS,
		),
	).rejects.toThrow(/username/i);

	const reloaded = await db.user.findOne(
		{ username: user.username },
		FULL_ACCESS,
	);
	expect(reloaded?.username).toBe("immutable-username");
});

test("create() rejects an instructor or student actor, accepts an admin", async () => {
	await expect(
		db.user.create(
			{
				email: "not-admin@codehood.test",
				username: "not-admin",
				name: "Not Admin",
				role: "STUDENT",
				password: "x",
				githubId: "not-admin",
				schoolId: "not-admin",
			},
			{ actor: actorOf("actor-instructor" as UserId, "INSTRUCTOR") },
		),
	).rejects.toThrow();

	const created = await db.user.create(
		{
			email: "admin-registered@codehood.test",
			username: "admin-registered",
			name: "Admin Registered",
			role: "STUDENT",
			password: "x",
			githubId: "admin-registered",
			schoolId: "admin-registered",
		},
		{ actor: actorOf("actor-admin" as UserId, "ADMIN") },
	);
	expect(created.username).toBe("admin-registered");
});

test("findMany visibility agrees with user.read: self sees only self, admin sees everyone", async () => {
	const admin = await db.user.create(
		{
			email: "visibility-admin@codehood.test",
			username: "visibility-admin",
			name: "Visibility Admin",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);
	const student = await db.user.create(
		{
			email: "visibility-student@codehood.test",
			username: "visibility-student",
			name: "Visibility Student",
			role: "STUDENT",
			password: "x",
			githubId: "visibility-student",
			schoolId: "visibility-student",
		},
		FULL_ACCESS,
	);

	const everyone = await db.user.findMany({}, FULL_ACCESS);

	const studentActor = actorOf(student.username as UserId, "STUDENT");
	const asStudent = await db.user.findMany({}, { actor: studentActor });
	expect(asStudent.map((u) => u.username).sort()).toEqual(
		everyone
			.filter((u) => hasPerm(studentActor, "user.read", u))
			.map((u) => u.username)
			.sort(),
	);
	expect(asStudent.map((u) => u.username)).toEqual([student.username]);

	const adminActor = actorOf(admin.username as UserId, "ADMIN");
	const asAdmin = await db.user.findMany({}, { actor: adminActor });
	expect(asAdmin.map((u) => u.username).sort()).toEqual(
		everyone
			.filter((u) => hasPerm(adminActor, "user.read", u))
			.map((u) => u.username)
			.sort(),
	);
	expect(asAdmin.length).toBe(everyone.length);
});

test("upsert creates on first call and updates the same row on the second: changed field applied, null clears, absent keeps", async () => {
	const username = "upsert-happy";
	const created = await db.user.upsert(
		{
			email: "upsert-happy@codehood.test",
			username,
			name: "Before",
			role: "STUDENT",
			password: "x",
			githubId: "gh-before",
			schoolId: "school-before",
		},
		FULL_ACCESS,
	);
	expect(created.githubId).toBe("gh-before");
	expect(created.schoolId).toBe("school-before");

	const updated = await db.user.upsert(
		{
			email: "upsert-happy@codehood.test",
			username,
			name: "After",
			role: "STUDENT",
			password: "x",
			schoolId: null,
		},
		FULL_ACCESS,
	);
	expect(updated.username).toBe(created.username);
	expect(updated.name).toBe("After"); // changed
	expect(updated.schoolId).toBeNull(); // cleared
	expect(updated.githubId).toBe("gh-before"); // absent -> kept

	const all = await db.user.findMany({ usernames: [username] }, FULL_ACCESS);
	expect(all).toHaveLength(1);
});

test("upsert requires create permission even when the actor may update the row: an instructor cannot upsert their own profile, though update() lets them", async () => {
	const instructor = await db.user.create(
		{
			email: "upsert-self@codehood.test",
			username: "upsert-self",
			name: "Self",
			role: "INSTRUCTOR",
			password: "x",
			githubId: "upsert-self",
			schoolId: "upsert-self",
		},
		FULL_ACCESS,
	);
	const selfActor = actorOf(instructor.username as UserId, "INSTRUCTOR");

	await expect(
		db.user.update(
			{ username: instructor.username },
			{ name: "Via update" },
			{ actor: selfActor },
		),
	).resolves.toMatchObject({ name: "Via update" });

	await expect(
		db.user.upsert(
			{
				email: instructor.email,
				username: instructor.username,
				name: "Via upsert",
				role: "INSTRUCTOR",
				password: "x",
			},
			{ actor: selfActor },
		),
	).rejects.toMatchObject({ action: "user.create" });

	const reloaded = await db.user.findOne(
		{ username: instructor.username },
		FULL_ACCESS,
	);
	expect(reloaded?.name).toBe("Via update");
});

test("upsert never touches an existing user's password: that goes through passwordChange", async () => {
	const username = "upsert-password";
	await db.user.upsert(
		{
			email: "upsert-password@codehood.test",
			username,
			name: "Pw",
			role: "STUDENT",
			password: "first-password",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
	const afterCreate = await db.user.findOne({ username }, FULL_ACCESS);
	const hashAfterCreate = afterCreate?.passwordHash as string;
	expect(hashAfterCreate).toBeTruthy();

	// `password` is required on the create branch, so a PUT carries one even
	// when the user is already there. It is ignored rather than applied.
	await db.user.upsert(
		{
			email: "upsert-password@codehood.test",
			username,
			name: "Pw2",
			role: "STUDENT",
			password: "second-password",
		},
		FULL_ACCESS,
	);
	const afterUpdate = await db.user.findOne({ username }, FULL_ACCESS);
	expect(afterUpdate?.name).toBe("Pw2");
	expect(afterUpdate?.passwordHash).toBe(hashAfterCreate);
	expect(await verifyPassword(hashAfterCreate, "first-password")).toBe(true);
});

/// A student account to create, with the given overrides.
function student(username: string, extra: Record<string, unknown> = {}) {
	return {
		email: `${username}@codehood.test`,
		username,
		name: username,
		role: "STUDENT" as const,
		password: "x",
		githubId: username,
		schoolId: username,
		...extra,
	};
}

test("a GitHub or school id shaped like the missing-value sentinel is refused on create and update", async () => {
	for (const field of ["githubId", "schoolId"]) {
		await expect(
			db.user.create(
				student(`sentinel-${field.toLowerCase()}`, { [field]: "!bob" }),
				FULL_ACCESS,
			),
		).rejects.toThrow();
	}

	const user = await db.user.create(student("sentinel-update"), FULL_ACCESS);
	for (const field of ["githubId", "schoolId"]) {
		await expect(
			db.user.update(
				{ username: user.username },
				{ [field]: "!bob" },
				FULL_ACCESS,
			),
		).rejects.toThrow();
	}
});

test("githubId follows GitHub's rule and is stored lowercase, without a leading @", async () => {
	const user = await db.user.create(
		student("gh-normalized", { githubId: " @Ana-Dev " }),
		FULL_ACCESS,
	);
	expect(user.githubId).toBe("ana-dev");

	for (const bad of ["-ana", "ana-", "a--b", "ana_b", "", "a".repeat(40)]) {
		await expect(
			db.user.create(
				student(`gh-bad-${bad.length}-${bad.charCodeAt(0) || 0}`, {
					githubId: bad,
				}),
				FULL_ACCESS,
			),
			bad,
		).rejects.toThrow();
	}
});

test("a school id with spaces or other symbols is refused", async () => {
	for (const bad of ["12 345", "12/345", "", "1".repeat(33)]) {
		await expect(
			db.user.create(
				student(`school-bad-${bad.length}`, { schoolId: bad }),
				FULL_ACCESS,
			),
			bad,
		).rejects.toThrow();
	}
});

test("a username typed with uppercase is stored lowercase, and the account logs in with either", async () => {
	const user = await db.user.create(student("Mixed-Case"), FULL_ACCESS);
	expect(user.username).toBe("mixed-case");
	expect(
		await db.user.findOne({ login: "MIXED-case" }, FULL_ACCESS),
	).not.toBeNull();
});

test("reserved usernames are refused for new accounts, in any case", async () => {
	for (const reserved of ["staff", "Me", "SYSTEM"]) {
		await expect(
			db.user.create(student(reserved), FULL_ACCESS),
			reserved,
		).rejects.toThrow();
	}
});
