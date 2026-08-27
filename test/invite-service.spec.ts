import { expect, test } from "@playwright/test";
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
