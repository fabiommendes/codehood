import { expect, test } from "@playwright/test";
import { userService } from "@/db/user.service";

test("admin without githubId/schoolId gets the @<username> default", async () => {
	const user = await userService.create({
		email: "root@codehood.test",
		username: "root",
		name: "Root",
		role: "ADMIN",
		password: "x",
	});
	expect(user.githubId).toBe("@root");
	expect(user.schoolId).toBe("@root");
});

test("student requires githubId and schoolId", async () => {
	await expect(
		userService.create({
			email: "s1@codehood.test",
			username: "s1",
			name: "S1",
			role: "STUDENT",
			password: "x",
		}),
	).rejects.toThrow();
});

test("publicId is generated and unique per user", async () => {
	const a = await userService.create({
		email: "a1@codehood.test",
		username: "a1",
		name: "A",
		role: "ADMIN",
		password: "x",
	});
	const b = await userService.create({
		email: "a2@codehood.test",
		username: "a2",
		name: "B",
		role: "ADMIN",
		password: "x",
	});
	expect(a.publicId).toHaveLength(10);
	expect(a.publicId).not.toBe(b.publicId);
});
