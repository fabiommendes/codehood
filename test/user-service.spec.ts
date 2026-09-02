import { expect, test } from "@playwright/test";
import { canViewUser } from "@/auth/permissions";
import { FULL_ACCESS } from "@/db/base-service";
import { userService } from "@/db/user.service";

test("admin without githubId/schoolId gets the @<username> default", async () => {
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
	expect(user.githubId).toBe("@root");
	expect(user.schoolId).toBe("@root");
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
			{ id: user.id },
			fieldsWithSmuggledUsername,
			FULL_ACCESS,
		),
	).rejects.toThrow(/username/i);

	const reloaded = await userService.findOne({ id: user.id }, FULL_ACCESS);
	expect(reloaded?.username).toBe("immutable-username");
});

test("publicId is generated and unique per user", async () => {
	const a = await userService.create(
		{
			email: "a1@codehood.test",
			username: "a1",
			name: "A",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);
	const b = await userService.create(
		{
			email: "a2@codehood.test",
			username: "a2",
			name: "B",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);
	expect(a.publicId).toHaveLength(10);
	expect(a.publicId).not.toBe(b.publicId);
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
			{ actor: { id: 1, role: "INSTRUCTOR" } },
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
		{ actor: { id: 2, role: "ADMIN" } },
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

	const asStudent = await userService.findMany(
		{},
		{ actor: { id: student.id, role: "STUDENT" } },
	);
	expect(asStudent.map((u) => u.id).sort()).toEqual(
		everyone
			.filter((u) => canViewUser({ id: student.id, role: "STUDENT" }, u))
			.map((u) => u.id)
			.sort(),
	);
	expect(asStudent.map((u) => u.id)).toEqual([student.id]);

	const asAdmin = await userService.findMany(
		{},
		{ actor: { id: admin.id, role: "ADMIN" } },
	);
	expect(asAdmin.map((u) => u.id).sort()).toEqual(
		everyone
			.filter((u) => canViewUser({ id: admin.id, role: "ADMIN" }, u))
			.map((u) => u.id)
			.sort(),
	);
	expect(asAdmin.length).toBe(everyone.length);
});
