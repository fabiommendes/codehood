import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { hashToken } from "@/auth/token";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedUserFactory } from "@/fixtures/user.factory";

/// The session of a fresh user, with the row behind its token.
async function session(role: "STUDENT" | "INSTRUCTOR" = "STUDENT") {
	const user = await persistedUserFactory.create({ role });
	const { token } = await db.session.create(
		{ username: user.username },
		FULL_ACCESS,
	);
	const tokenHash = hashToken(token as string);
	const row = () => prisma.session.findUnique({ where: { tokenHash } });
	const expiresAt = (at: Date) =>
		prisma.session.update({ where: { tokenHash }, data: { expiresAt: at } });
	return { user, token: token as string, row, expiresAt };
}

test("validate answers with the user of the session and when it expires", async () => {
	const s = await session("INSTRUCTOR");

	const valid = await db.session.validate(s.token);

	expect(valid?.user).toEqual({
		username: s.user.username,
		name: s.user.name,
		role: "INSTRUCTOR",
	});
	expect(valid?.expiresAt).toEqual((await s.row())?.expiresAt);
});

test("validate knows no session for a token nobody was given", async () => {
	expect(await db.session.validate("no-such-token")).toBeNull();
});

test("validate drops an expired session", async () => {
	const s = await session();
	await s.expiresAt(new Date(Date.now() - 1000));

	expect(await db.session.validate(s.token)).toBeNull();
	expect(await s.row()).toBeNull();
});

test("validate slides the expiry of a session close to its end, and leaves a fresh one alone", async () => {
	const s = await session();
	const fresh = (await s.row())?.expiresAt;
	await db.session.validate(s.token);
	expect((await s.row())?.expiresAt).toEqual(fresh);

	const soon = new Date(Date.now() + 60_000);
	await s.expiresAt(soon);
	await db.session.validate(s.token);
	expect((await s.row())?.expiresAt.getTime()).toBeGreaterThan(soon.getTime());
});
