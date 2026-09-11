import { expect, test } from "@playwright/test";
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

test("admin without githubId/schoolId has them unset, not the sentinel", async () => {
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
	expect(user.githubId).toBeUndefined();
	expect(user.schoolId).toBeUndefined();
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
