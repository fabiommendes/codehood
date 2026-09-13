import { expect, test } from "@playwright/test";
import { verifyPassword } from "@/auth/password";
import { canViewUser } from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { FULL_ACCESS } from "@/core/actor";
import type { UserId } from "@/core/schemas";
import { userService } from "@/db/services/user.service";

function actorOf(
	username: UserId,
	role: "ADMIN" | "INSTRUCTOR" | "STUDENT",
): Actor {
	return { username, role } as unknown as Actor;
}

test("admin without githubId/schoolId has them null, not the sentinel", async () => {
	const user = await userService.create(
		{
			email: "root@codehood.test",
			username: "root",
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
		userService.create(
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
	const user = await userService.create(
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
		userService.update(
			{ username: user.username },
			fieldsWithSmuggledUsername,
			FULL_ACCESS,
		),
	).rejects.toThrow(/username/i);

	const reloaded = await userService.findOne(
		{ username: user.username },
		FULL_ACCESS,
	);
	expect(reloaded?.username).toBe("immutable-username");
});

test("create() rejects an instructor or student actor, accepts an admin", async () => {
	await expect(
		userService.create(
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

	const created = await userService.create(
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

test("findMany visibility agrees with canViewUser: self sees only self, admin sees everyone", async () => {
	const admin = await userService.create(
		{
			email: "visibility-admin@codehood.test",
			username: "visibility-admin",
			name: "Visibility Admin",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);
	const student = await userService.create(
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

	const everyone = await userService.findMany({}, FULL_ACCESS);

	const studentActor = actorOf(student.username as UserId, "STUDENT");
	const asStudent = await userService.findMany({}, { actor: studentActor });
	expect(asStudent.map((u) => u.username).sort()).toEqual(
		everyone
			.filter((u) => canViewUser(studentActor, u))
			.map((u) => u.username)
			.sort(),
	);
	expect(asStudent.map((u) => u.username)).toEqual([student.username]);

	const adminActor = actorOf(admin.username as UserId, "ADMIN");
	const asAdmin = await userService.findMany({}, { actor: adminActor });
	expect(asAdmin.map((u) => u.username).sort()).toEqual(
		everyone
			.filter((u) => canViewUser(adminActor, u))
			.map((u) => u.username)
			.sort(),
	);
	expect(asAdmin.length).toBe(everyone.length);
});

test("upsert creates on first call and updates the same row on the second: changed field applied, null clears, absent keeps", async () => {
	const username = "upsert-happy";
	const created = await userService.upsert(
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

	const updated = await userService.upsert(
		{
			email: "upsert-happy@codehood.test",
			username,
			name: "After",
			role: "STUDENT",
			schoolId: null,
		},
		FULL_ACCESS,
	);
	expect(updated.username).toBe(created.username);
	expect(updated.name).toBe("After"); // changed
	expect(updated.schoolId).toBeNull(); // cleared
	expect(updated.githubId).toBe("gh-before"); // absent -> kept

	const all = await userService.findMany(
		{ usernames: [username] },
		FULL_ACCESS,
	);
	expect(all).toHaveLength(1);
});

test("upsert requires create permission even when the actor may update the row: an instructor cannot upsert their own profile, though update() lets them", async () => {
	const instructor = await userService.create(
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
		userService.update(
			{ username: instructor.username },
			{ name: "Via update" },
			{ actor: selfActor },
		),
	).resolves.toMatchObject({ name: "Via update" });

	await expect(
		userService.upsert(
			{
				email: instructor.email,
				username: instructor.username,
				name: "Via upsert",
				role: "INSTRUCTOR",
			},
			{ actor: selfActor },
		),
	).rejects.toMatchObject({ action: "upsert-user" });

	const reloaded = await userService.findOne(
		{ username: instructor.username },
		FULL_ACCESS,
	);
	expect(reloaded?.name).toBe("Via update");
});

test("upsert without a password leaves the stored hash unchanged; with one, resets it", async () => {
	const username = "upsert-password";
	await userService.upsert(
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
	const afterCreate = await userService.findOne({ username }, FULL_ACCESS);
	const hashAfterCreate = afterCreate?.passwordHash as string;
	expect(hashAfterCreate).toBeTruthy();

	await userService.upsert(
		{
			email: "upsert-password@codehood.test",
			username,
			name: "Pw2",
			role: "STUDENT",
		},
		FULL_ACCESS,
	);
	const afterNoPassword = await userService.findOne({ username }, FULL_ACCESS);
	expect(afterNoPassword?.passwordHash).toBe(hashAfterCreate);
	expect(await verifyPassword(hashAfterCreate, "first-password")).toBe(true);

	await userService.upsert(
		{
			email: "upsert-password@codehood.test",
			username,
			name: "Pw3",
			role: "STUDENT",
			password: "second-password",
		},
		FULL_ACCESS,
	);
	const afterNewPassword = await userService.findOne({ username }, FULL_ACCESS);
	expect(afterNewPassword?.passwordHash).not.toBe(hashAfterCreate);
	expect(
		await verifyPassword(
			afterNewPassword?.passwordHash as string,
			"second-password",
		),
	).toBe(true);
});
