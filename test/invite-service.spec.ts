import { expect, test } from "@playwright/test";
import { canViewInvite } from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { FULL_ACCESS } from "@/core/actor";
import type { CourseId, UserId } from "@/core/schemas";
import { inviteService } from "@/db/services/invite.service";
import { userService } from "@/db/services/user.service";

function actorOf(
	username: UserId,
	role: "ADMIN" | "INSTRUCTOR" | "STUDENT",
): Actor {
	return { username, name: username, role };
}

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
			invitedRole: "STUDENT",
			courseId: null,
			createdBy: { username: admin.username, name: admin.name },
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const inviteToken = token!;

	const invite = await inviteService.findOne(
		{ token: inviteToken },
		FULL_ACCESS,
	);
	expect(invite).not.toBeNull();
	// biome-ignore lint/style/noNonNullAssertion: asserted above
	expect(inviteService.checkRedeemable(invite!, "wrong@codehood.test")).toBe(
		"email_mismatch",
	);
	expect(
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		inviteService.checkRedeemable(invite!, "invitee1@codehood.test"),
	).toBeUndefined();

	const invitee = await makeStudent("invitee1@codehood.test", "invitee1");
	await inviteService.redeem(
		inviteToken,
		invitee.username,
		"invitee1@codehood.test",
		FULL_ACCESS,
	);

	const second = await makeStudent("invitee1b@codehood.test", "invitee1b");
	await expect(
		inviteService.redeem(
			inviteToken,
			second.username,
			"invitee1@codehood.test",
			FULL_ACCESS,
		),
	).rejects.toMatchObject({
		code: "exhausted",
	});
});

test("classroom invite: redeemable up to maxUses, then exhausted", async () => {
	const admin = await makeAdmin("inviter2@codehood.test");
	const { token } = await inviteService.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			courseId: 1 as CourseId,
			createdBy: { username: admin.username, name: admin.name },
			maxUses: 2,
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const inviteToken = token!;

	for (const i of [1, 2]) {
		const user = await makeStudent(`class${i}@codehood.test`, `class${i}`);
		await inviteService.redeem(
			inviteToken,
			user.username,
			`class${i}@codehood.test`,
			FULL_ACCESS,
		);
	}

	const overflow = await makeStudent("class3@codehood.test", "class3");
	await expect(
		inviteService.redeem(
			inviteToken,
			overflow.username,
			"class3@codehood.test",
			FULL_ACCESS,
		),
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
			invitedRole: "STUDENT",
			courseId: null,
			createdBy: { username: admin.username, name: admin.name },
			expiresInMs: -1,
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const inviteToken = token!;

	const invite = await inviteService.findOne(
		{ token: inviteToken },
		FULL_ACCESS,
	);
	// biome-ignore lint/style/noNonNullAssertion: asserted below
	expect(inviteService.checkRedeemable(invite!, "late@codehood.test")).toBe(
		"expired",
	);

	const user = await makeStudent("late@codehood.test", "late");
	await expect(
		inviteService.redeem(
			inviteToken,
			user.username,
			"late@codehood.test",
			FULL_ACCESS,
		),
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
				invitedRole: "STUDENT",
				courseId: null,
				maxUses: 1,
				createdBy: { username: creator.username, name: creator.name },
			},
			FULL_ACCESS,
		);
	}

	const all = await inviteService.findMany({}, FULL_ACCESS);
	expect(all.length).toBeGreaterThanOrEqual(3);

	const actors: Actor[] = [
		actorOf(admin.username, "ADMIN"),
		actorOf(instructorA.username, "INSTRUCTOR"),
		actorOf(student.username, "STUDENT"),
	];
	for (const actor of actors) {
		const visible = await inviteService.findMany({}, { actor });
		const expected = all.filter((invite) =>
			canViewInvite(actor, { createdById: invite.createdBy.username }),
		);
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
			invitedRole: "STUDENT",
			email: null,
			courseId: null,
			maxUses: 5,
			createdBy: { username: instructor.username, name: instructor.name },
		},
		FULL_ACCESS,
	);

	const [invite] = await inviteService.findMany(
		{ createdById: instructor.username },
		FULL_ACCESS,
	);
	expect(invite.createdBy.username).toBe("list-instructor");
	expect(invite.redemptions).toBe(0);
	expect(invite).not.toHaveProperty("token");
});

test("update() extends an expiry and adjusts maxUses, and refuses another instructor", async () => {
	const owner = await makeInstructor("update-owner");
	const other = await makeInstructor("update-other");
	const invite = await inviteService.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			courseId: null,
			maxUses: 2,
			createdBy: { username: owner.username, name: owner.name },
		},
		FULL_ACCESS,
	);

	await expect(
		inviteService.update(
			{ id: invite.id },
			{ maxUses: 99 },
			{ actor: actorOf(other.username, "INSTRUCTOR") },
		),
	).rejects.toThrow();

	const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
	const updated = await inviteService.update(
		{ id: invite.id },
		{ expiresAt: later, maxUses: null },
		{ actor: actorOf(owner.username, "INSTRUCTOR") },
	);
	expect(updated.expiresAt).toEqual(later);
	expect(updated.maxUses).toBeNull();
});

test("delete() refuses a stranger, and succeeds for the creator and for an admin", async () => {
	const owner = await makeInstructor("delete-owner");
	const other = await makeInstructor("delete-other");
	const admin = await makeAdmin("delete-admin@codehood.test");

	const first = await inviteService.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			courseId: null,
			maxUses: null,
			createdBy: { username: owner.username, name: owner.name },
		},
		FULL_ACCESS,
	);
	await expect(
		inviteService.delete(
			{ id: first.id },
			{ actor: actorOf(other.username, "INSTRUCTOR") },
		),
	).rejects.toThrow();
	await inviteService.delete(
		{ id: first.id },
		{ actor: actorOf(owner.username, "INSTRUCTOR") },
	);
	expect(
		// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
		await inviteService.findOne({ token: first.token! }, FULL_ACCESS),
	).toBeNull();

	const second = await inviteService.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			courseId: null,
			maxUses: null,
			createdBy: { username: owner.username, name: owner.name },
		},
		FULL_ACCESS,
	);
	await inviteService.delete(
		{ id: second.id },
		{ actor: actorOf(admin.username, "ADMIN") },
	);
	expect(
		// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
		await inviteService.findOne({ token: second.token! }, FULL_ACCESS),
	).toBeNull();
});
