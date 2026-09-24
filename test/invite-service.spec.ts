import { expect, test } from "@playwright/test";
import type { Actor } from "@/auth/actor";
import { FULL_ACCESS } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import type { CourseId, UserId } from "@/core/schemas";
import { db } from "@/db";

function actorOf(
	username: UserId,
	role: "ADMIN" | "INSTRUCTOR" | "STUDENT",
): Actor {
	return { username, name: username, role };
}

function makeAdmin(email: string) {
	return db.user.create(
		{
			email,
			username: email.split("@")[0] as string,
			name: "Admin",
			role: "ADMIN",
			password: "x",
		},
		FULL_ACCESS,
	);
}

function makeStudent(email: string, tag: string) {
	return db.user.create(
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

async function makeCourse(instructorUsername: UserId, tag: string) {
	await db.discipline.create({ slug: tag, name: tag }, FULL_ACCESS);
	return db.course.create(
		{
			discipline: tag,
			instructor: instructorUsername,
			edition: await ensureEdition(),
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

test("personal invite: redeems for the invited email, rejects others, then is exhausted", async () => {
	const admin = await makeAdmin("inviter1@codehood.test");
	const { token } = await db.invite.create(
		{
			kind: "PERSONAL",
			maxUses: 1,
			email: "invitee1@codehood.test",
			invitedRole: "STUDENT",
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const inviteToken = token!;

	const invite = await db.invite.findOne({ token: inviteToken }, FULL_ACCESS);
	expect(invite).not.toBeNull();
	// biome-ignore lint/style/noNonNullAssertion: asserted above
	expect(db.invite.checkRedeemable(invite!, "wrong@codehood.test")).toBe(
		"email_mismatch",
	);
	expect(
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		db.invite.checkRedeemable(invite!, "invitee1@codehood.test"),
	).toBeUndefined();

	const invitee = await makeStudent("invitee1@codehood.test", "invitee1");
	await db.invite.redeem(
		inviteToken,
		invitee.username,
		"invitee1@codehood.test",
		FULL_ACCESS,
	);

	const second = await makeStudent("invitee1b@codehood.test", "invitee1b");
	await expect(
		db.invite.redeem(
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
	const owner = await makeInstructor("inviter2-owner");
	const course = await makeCourse(owner.username, "inv-disc-classroom");
	const { token } = await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			course: course.id,
			maxUses: 2,
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const inviteToken = token!;

	for (const i of [1, 2]) {
		const user = await makeStudent(`class${i}@codehood.test`, `class${i}`);
		await db.invite.redeem(
			inviteToken,
			user.username,
			`class${i}@codehood.test`,
			FULL_ACCESS,
		);
	}

	const overflow = await makeStudent("class3@codehood.test", "class3");
	await expect(
		db.invite.redeem(
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
	const { token } = await db.invite.create(
		{
			kind: "PERSONAL",
			maxUses: 1,
			email: "late@codehood.test",
			invitedRole: "STUDENT",
			expiresInMs: -1,
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const inviteToken = token!;

	const invite = await db.invite.findOne({ token: inviteToken }, FULL_ACCESS);
	// biome-ignore lint/style/noNonNullAssertion: asserted below
	expect(db.invite.checkRedeemable(invite!, "late@codehood.test")).toBe(
		"expired",
	);

	const user = await makeStudent("late@codehood.test", "late");
	await expect(
		db.invite.redeem(
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
	return db.user.create(
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

test("findMany visibility agrees with invite.read: admins see all, instructors see their own, students see none", async () => {
	const admin = await makeAdmin("vis-admin@codehood.test");
	const instructorA = await makeInstructor("vis-instructor-a");
	const instructorB = await makeInstructor("vis-instructor-b");
	const student = await makeStudent("vis-student@codehood.test", "vis-student");

	for (const creator of [admin, instructorA, instructorB]) {
		await db.invite.create(
			{
				kind: "PERSONAL",
				email: `invitee-of-${creator.username}@codehood.test`,
				invitedRole: "STUDENT",
				maxUses: 1,
				createdBy: { username: creator.username, name: creator.name },
			},
			FULL_ACCESS,
		);
	}

	const all = await db.invite.findMany({}, FULL_ACCESS);
	expect(all.length).toBeGreaterThanOrEqual(3);

	const actors: Actor[] = [
		actorOf(admin.username, "ADMIN"),
		actorOf(instructorA.username, "INSTRUCTOR"),
		actorOf(student.username, "STUDENT"),
	];
	for (const actor of actors) {
		const visible = await db.invite.findMany({}, { actor });
		const expected = all.filter((invite) =>
			hasPerm(actor, "invite.read", invite),
		);
		expect(visible.map((i) => i.id).sort()).toEqual(
			expected.map((i) => i.id).sort(),
		);
	}
});

test("findMany carries the creator and the redemption count, never a token", async () => {
	const instructor = await makeInstructor("list-instructor");
	await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			maxUses: 5,
			createdBy: { username: instructor.username, name: instructor.name },
		},
		FULL_ACCESS,
	);

	const [invite] = await db.invite.findMany(
		{ createdBy: instructor.username },
		FULL_ACCESS,
	);
	expect(invite?.createdBy.username).toBe("list-instructor");
	expect(invite?.redemptions).toBe(0);
	expect(invite).not.toHaveProperty("token");
});

test("update() extends an expiry and adjusts maxUses, and refuses another instructor", async () => {
	const owner = await makeInstructor("update-owner");
	const other = await makeInstructor("update-other");
	const invite = await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			maxUses: 2,
			createdBy: { username: owner.username, name: owner.name },
		},
		FULL_ACCESS,
	);

	await expect(
		db.invite.update(
			{ id: invite.id },
			{ maxUses: 99 },
			{ actor: actorOf(other.username, "INSTRUCTOR") },
		),
	).rejects.toThrow();

	const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
	const updated = await db.invite.update(
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

	const first = await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			maxUses: null,
			createdBy: { username: owner.username, name: owner.name },
		},
		FULL_ACCESS,
	);
	await expect(
		db.invite.delete(
			{ id: first.id },
			{ actor: actorOf(other.username, "INSTRUCTOR") },
		),
	).rejects.toThrow();
	await db.invite.delete(
		{ id: first.id },
		{ actor: actorOf(owner.username, "INSTRUCTOR") },
	);
	expect(
		// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
		await db.invite.findOne({ token: first.token! }, FULL_ACCESS),
	).toBeNull();

	const second = await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			maxUses: null,
			createdBy: { username: owner.username, name: owner.name },
		},
		FULL_ACCESS,
	);
	await db.invite.delete(
		{ id: second.id },
		{ actor: actorOf(admin.username, "ADMIN") },
	);
	expect(
		// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
		await db.invite.findOne({ token: second.token! }, FULL_ACCESS),
	).toBeNull();
});

test("findOne by id is actor-filtered; by token it is not", async () => {
	const owner = await db.user.create(
		{
			email: "inviteowner@codehood.test",
			username: "invite-owner",
			name: "Invite Owner",
			role: "INSTRUCTOR",
			password: "x",
			githubId: "invite-owner",
			schoolId: "invite-owner",
		},
		FULL_ACCESS,
	);
	const other = await db.user.create(
		{
			email: "inviteother@codehood.test",
			username: "invite-other",
			name: "Invite Other",
			role: "INSTRUCTOR",
			password: "x",
			githubId: "invite-other",
			schoolId: "invite-other",
		},
		FULL_ACCESS,
	);
	const student = await makeStudent(
		"invitesnoop@codehood.test",
		"invite-snoop",
	);

	const created = await db.invite.create(
		{
			kind: "PERSONAL",
			maxUses: 1,
			email: "invitetarget@codehood.test",
			invitedRole: "STUDENT",
		},
		{ actor: owner },
	);

	// Ids are sequential, so an unfiltered lookup lets anyone walk every
	// invite's email, role, course and creator.
	await expect(
		db.invite.findOne(
			{ id: created.id },
			{ actor: actorOf(student.username, "STUDENT") },
		),
	).rejects.toThrow();
	await expect(
		db.invite.findOne(
			{ id: created.id },
			{ actor: actorOf(other.username, "INSTRUCTOR") },
		),
	).rejects.toThrow();

	// The issuer and an admin still see it.
	expect(
		await db.invite.findOne({ id: created.id }, { actor: owner }),
	).not.toBeNull();

	// The raw token is the credential: redemption looks an invite up before
	// the redeemer has an account, so that path stays unfiltered.
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const raw = created.token!;
	expect(
		await db.invite.findOne(
			{ token: raw },
			{ actor: actorOf(student.username, "STUDENT") },
		),
	).not.toBeNull();
});

test("an invite never exposes its token hash", async () => {
	const admin = await makeAdmin("invitehash@codehood.test");
	const created = await db.invite.create(
		{
			kind: "CLASSROOM",
			maxUses: null,
			email: null,
			invitedRole: "STUDENT",
		},
		{ actor: admin },
	);

	expect(created).not.toHaveProperty("tokenHash");
	const fetched = await db.invite.findOne({ id: created.id }, { actor: admin });
	expect(fetched).not.toHaveProperty("tokenHash");
});

test("a course invite requires the right to enrol into that course", async () => {
	const owner = await makeInstructor("inv-owner");
	const other = await makeInstructor("inv-other");
	const admin = await makeAdmin("inv-crossadmin@codehood.test");
	const course = await makeCourse(owner.username, "inv-disc-cross");
	const input = {
		kind: "CLASSROOM" as const,
		maxUses: null,
		email: null,
		invitedRole: "STUDENT" as const,
		course: course.id,
	};

	await expect(db.invite.create(input, { actor: other })).rejects.toMatchObject(
		{ status: 403 },
	);

	await expect(
		db.invite.create(input, { actor: owner }),
	).resolves.toMatchObject({ courseId: course.id });

	await expect(
		db.invite.create(input, { actor: admin }),
	).resolves.toMatchObject({ courseId: course.id });
});

test("an invite with no course still works for the allowed role", async () => {
	const instructor = await makeInstructor("inv-nocourse");
	await expect(
		db.invite.create(
			{
				kind: "PERSONAL",
				maxUses: 1,
				email: "inv-nocourse-guest@codehood.test",
				invitedRole: "STUDENT",
			},
			{ actor: instructor },
		),
	).resolves.toMatchObject({ courseId: null });
});

test("a course invite for a course that does not exist is refused", async () => {
	const admin = await makeAdmin("inv-ghostcourse@codehood.test");
	await expect(
		db.invite.create(
			{
				kind: "CLASSROOM",
				maxUses: null,
				email: null,
				invitedRole: "STUDENT",
				course: 999999 as CourseId,
			},
			{ actor: admin },
		),
	).rejects.toMatchObject({ status: 404 });
});

test("createdBy sent by a non-SYSTEM caller is ignored: the actor is always recorded", async () => {
	const owner = await makeInstructor("inv-forge-owner");
	const impersonated = await makeInstructor("inv-forge-victim");

	const invite = await db.invite.create(
		{
			kind: "PERSONAL",
			maxUses: 1,
			email: "inv-forge-guest@codehood.test",
			invitedRole: "STUDENT",
			createdBy: { username: impersonated.username, name: impersonated.name },
		},
		{ actor: owner },
	);

	expect(invite.createdBy.username).toBe(owner.username);

	const fetched = await db.invite.findOne({ id: invite.id }, { actor: owner });
	expect(fetched?.createdBy.username).toBe(owner.username);
});

test("a SYSTEM call without createdBy is rejected", async () => {
	await expect(
		db.invite.create(
			{
				kind: "PERSONAL",
				maxUses: 1,
				email: "inv-nocreator@codehood.test",
				invitedRole: "STUDENT",
			},
			FULL_ACCESS,
		),
	).rejects.toMatchObject({ status: 400 });
});
