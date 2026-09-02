import { expect, test } from "@playwright/test";
import { canViewInvite } from "@/auth/permissions";
import { FULL_ACCESS } from "@/db/base-service";
import { checkRedeemable, inviteService } from "@/db/invite.service";
import { userService } from "@/db/user.service";

function makeAdmin(email: string) {
	return userService.create(
		{
			email,
			username: email.split("@")[0],
			name: "Admin",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);
}

function makeStudent(email: string, tag: string) {
	return userService.create(
		{
			email,
			username: tag,
			name: tag,
			role: "STUDENT",
			password: "x",
			githubId: tag,
			schoolId: tag,
		},
		FULL_ACCESS,
	);
}

test("personal invite: redeems for the invited email, rejects others, then is exhausted", async () => {
	const admin = await makeAdmin("inviter1@codehood.test");
	const { token } = await inviteService.create(
		{
			kind: "PERSONAL",
			maxUses: 1,
			email: "invitee1@codehood.test",
			role: "STUDENT",
			createdById: admin.id,
		},
		{ actor: admin },
	);

	const invite = await inviteService.findOne({ token }, FULL_ACCESS);
	expect(invite).not.toBeNull();
	// biome-ignore lint/style/noNonNullAssertion: asserted above
	expect(checkRedeemable(invite!, "wrong@codehood.test")).toBe(
		"email_mismatch",
	);
	// biome-ignore lint/style/noNonNullAssertion: asserted above
	expect(checkRedeemable(invite!, "invitee1@codehood.test")).toBeUndefined();

	const invitee = await makeStudent("invitee1@codehood.test", "invitee1");
	await inviteService.redeem(token, invitee.id, "invitee1@codehood.test");

	const second = await makeStudent("invitee1b@codehood.test", "invitee1b");
	await expect(
		inviteService.redeem(token, second.id, "invitee1@codehood.test"),
	).rejects.toMatchObject({
		code: "exhausted",
	});
});

test("classroom invite: redeemable up to maxUses, then exhausted", async () => {
	const admin = await makeAdmin("inviter2@codehood.test");
	const { token } = await inviteService.create(
		{
			kind: "CLASSROOM",
			role: "STUDENT",
			courseId: 1,
			createdById: admin.id,
			maxUses: 2,
		},
		{ actor: admin },
	);

	for (const i of [1, 2]) {
		const user = await makeStudent(`class${i}@codehood.test`, `class${i}`);
		await inviteService.redeem(token, user.id, `class${i}@codehood.test`);
	}

	const overflow = await makeStudent("class3@codehood.test", "class3");
	await expect(
		inviteService.redeem(token, overflow.id, "class3@codehood.test"),
	).rejects.toMatchObject({
		code: "exhausted",
	});
});

test("expired invite is rejected before redemption", async () => {
	const admin = await makeAdmin("inviter3@codehood.test");
	const { token } = await inviteService.create(
		{
			kind: "PERSONAL",
			maxUses: 1,
			email: "late@codehood.test",
			role: "STUDENT",
			createdById: admin.id,
			expiresInMs: -1,
		},
		{ actor: admin },
	);

	const invite = await inviteService.findOne({ token }, FULL_ACCESS);
	// biome-ignore lint/style/noNonNullAssertion: asserted below
	expect(checkRedeemable(invite!, "late@codehood.test")).toBe("expired");

	const user = await makeStudent("late@codehood.test", "late");
	await expect(
		inviteService.redeem(token, user.id, "late@codehood.test"),
	).rejects.toMatchObject({
		code: "expired",
	});
});

function makeInstructor(tag: string) {
	return userService.create(
		{
			email: `${tag}@codehood.test`,
			username: tag,
			name: tag,
			role: "INSTRUCTOR",
			password: "x",
			githubId: tag,
			schoolId: tag,
		},
		FULL_ACCESS,
	);
}

test("findMany visibility agrees with canViewInvite: admins see all, instructors see their own, students see none", async () => {
	const admin = await makeAdmin("vis-admin@codehood.test");
	const instructorA = await makeInstructor("vis-instructor-a");
	const instructorB = await makeInstructor("vis-instructor-b");
	const student = await makeStudent("vis-student@codehood.test", "vis-student");

	for (const creator of [admin, instructorA, instructorB]) {
		await inviteService.create(
			{
				kind: "PERSONAL",
				email: `invitee-of-${creator.username}@codehood.test`,
				role: "STUDENT",
				maxUses: 1,
				createdById: creator.id,
			},
			FULL_ACCESS,
		);
	}

	const all = await inviteService.findMany({}, FULL_ACCESS);
	expect(all.length).toBeGreaterThanOrEqual(3);

	for (const actor of [
		{ id: admin.id, role: "ADMIN" as const },
		{ id: instructorA.id, role: "INSTRUCTOR" as const },
		{ id: student.id, role: "STUDENT" as const },
	]) {
		const visible = await inviteService.findMany({}, { actor });
		const expected = all.filter((invite) => canViewInvite(actor, invite));
		expect(visible.map((i) => i.id).sort()).toEqual(
			expected.map((i) => i.id).sort(),
		);
	}
});

test("findMany carries the creator and the redemption count, never a token", async () => {
	const instructor = await makeInstructor("list-instructor");
	await inviteService.create(
		{
			kind: "CLASSROOM",
			role: "STUDENT",
			maxUses: 5,
			createdById: instructor.id,
		},
		FULL_ACCESS,
	);

	const [invite] = await inviteService.findMany(
		{ createdById: instructor.id },
		FULL_ACCESS,
	);
	expect(invite.createdBy.username).toBe("list-instructor");
	expect(invite._count.redemptions).toBe(0);
	expect(invite).not.toHaveProperty("token");
});

test("update() extends an expiry and adjusts maxUses, and refuses another instructor", async () => {
	const owner = await makeInstructor("update-owner");
	const other = await makeInstructor("update-other");
	const { invite } = await inviteService.create(
		{
			kind: "CLASSROOM",
			role: "STUDENT",
			maxUses: 2,
			createdById: owner.id,
		},
		FULL_ACCESS,
	);

	await expect(
		inviteService.update(
			{ id: invite.id },
			{ maxUses: 99 },
			{ actor: { id: other.id, role: "INSTRUCTOR" } },
		),
	).rejects.toThrow();

	const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
	const updated = await inviteService.update(
		{ id: invite.id },
		{ expiresAt: later, maxUses: null },
		{ actor: { id: owner.id, role: "INSTRUCTOR" } },
	);
	expect(updated.expiresAt).toEqual(later);
	expect(updated.maxUses).toBeNull();
});

test("delete() refuses a stranger, and succeeds for the creator and for an admin", async () => {
	const owner = await makeInstructor("delete-owner");
	const other = await makeInstructor("delete-other");
	const admin = await makeAdmin("delete-admin@codehood.test");

	const first = await inviteService.create(
		{ kind: "CLASSROOM", role: "STUDENT", createdById: owner.id },
		FULL_ACCESS,
	);
	await expect(
		inviteService.delete(
			{ id: first.invite.id },
			{ actor: { id: other.id, role: "INSTRUCTOR" } },
		),
	).rejects.toThrow();
	await inviteService.delete(
		{ id: first.invite.id },
		{ actor: { id: owner.id, role: "INSTRUCTOR" } },
	);
	expect(
		await inviteService.findOne({ token: first.token }, FULL_ACCESS),
	).toBeNull();

	const second = await inviteService.create(
		{ kind: "CLASSROOM", role: "STUDENT", createdById: owner.id },
		FULL_ACCESS,
	);
	await inviteService.delete(
		{ id: second.invite.id },
		{ actor: { id: admin.id, role: "ADMIN" } },
	);
	expect(
		await inviteService.findOne({ token: second.token }, FULL_ACCESS),
	).toBeNull();
});
