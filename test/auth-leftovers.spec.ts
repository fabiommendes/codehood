import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { dummyPasswordHash, verifyPassword } from "@/auth/password";
import { inviteUpdate } from "@/core/schemas";
import { db } from "@/db";
import { userFactory } from "@/fixtures/user.factory";

// Regressions for small auth gaps. API-level, no page behind them.

const ADMIN_PASSWORD = "correct horse battery staple";

/// Logs in a fresh admin, so a parallel logout of the seeded one cannot revoke the token.
async function adminToken(request: APIRequestContext) {
	const admin = userFactory.build({ role: "ADMIN", password: ADMIN_PASSWORD });
	await db.user.create(admin, FULL_ACCESS);
	const login = await request.post("/api/auth/login", {
		data: { login: admin.username, password: ADMIN_PASSWORD },
	});
	expect(login.ok()).toBe(true);
	return (await login.json()).token;
}

test("personal invite: the email match ignores case", async () => {
	const admin = await db.user.create(
		userFactory.build({ role: "ADMIN", username: "leftover-admin" }),
		FULL_ACCESS,
	);
	const { token } = await db.invite.create(
		{
			kind: "PERSONAL",
			maxUses: 1,
			email: "Mixed.Case@codehood.test",
			invitedRole: "STUDENT",
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const invite = await db.invite.findOne({ token: token! }, FULL_ACCESS);
	// biome-ignore lint/style/noNonNullAssertion: just created
	const found = invite!;
	expect(
		db.invite.checkRedeemable(found, "mixed.case@CODEHOOD.test"),
	).toBeUndefined();
	expect(db.invite.checkRedeemable(found, "other@codehood.test")).toBe(
		"email_mismatch",
	);
});

test("InviteService.redeem only maps the unique violation to already_redeemed", async () => {
	const admin = await db.user.create(
		userFactory.build({ role: "ADMIN", username: "leftover-admin2" }),
		FULL_ACCESS,
	);
	const { token } = await db.invite.create(
		{
			kind: "CLASSROOM",
			maxUses: 5,
			invitedRole: "STUDENT",
			email: null,
		},
		{ actor: admin },
	);
	// biome-ignore lint/style/noNonNullAssertion: create() always sets a token
	const inviteToken = token!;

	// No such user: the insert fails on the foreign key, not the unique index.
	const error = await db.invite
		.redeem(inviteToken, "ghost-user", "ghost@codehood.test", FULL_ACCESS)
		.catch((e: unknown) => e);
	expect(error).toBeInstanceOf(Error);
	expect((error as { code?: string }).code).not.toBe("already_redeemed");
});

test("inviteUpdate is strict and maxUses is an integer >= 1", () => {
	expect(inviteUpdate.safeParse({ maxUses: 3 }).success).toBe(true);
	expect(inviteUpdate.safeParse({ maxUses: null }).success).toBe(true);
	for (const maxUses of [0, -1, 1.5]) {
		expect(inviteUpdate.safeParse({ maxUses }).success).toBe(false);
	}
	expect(inviteUpdate.safeParse({ role: "ADMIN" }).success).toBe(false);
	expect(inviteUpdate.safeParse({ kind: "PERSONAL" }).success).toBe(false);
});

test("API login does the same hashing work for an unknown user", async ({
	request,
}) => {
	const user = userFactory.build({ role: "STUDENT" });
	await db.user.create(user, FULL_ACCESS);

	expect(await verifyPassword(await dummyPasswordHash(), "anything")).toBe(
		false,
	);

	const fastest = async (login: string) => {
		let best = Number.POSITIVE_INFINITY;
		for (let i = 0; i < 5; i++) {
			const start = performance.now();
			const res = await request.post("/api/auth/login", {
				data: { login, password: "wrong-password" },
			});
			best = Math.min(best, performance.now() - start);
			expect(res.status()).toBe(401);
		}
		return best;
	};
	const known = await fastest(user.username);
	const unknown = await fastest("nobody-by-this-name");
	expect(unknown).toBeGreaterThan(known * 0.5);
});

test("POST /api/user refuses a weak password", async ({ request }) => {
	const token = await adminToken(request);
	const headers = { Authorization: `Bearer ${token}` };

	const weak = userFactory.build({ role: "INSTRUCTOR", password: "short" });
	const refused = await request.post("/api/user", { headers, data: weak });
	expect(refused.status()).toBe(400);
	expect(await db.user.findOne({ username: weak.username }, FULL_ACCESS)).toBe(
		null,
	);

	const strong = userFactory.build({
		role: "INSTRUCTOR",
		password: "correct horse battery staple",
	});
	const created = await request.post("/api/user", { headers, data: strong });
	expect(created.status()).toBe(200);
});

test("deleting an unknown API key is a NotFound, not a 403", async ({
	request,
}) => {
	const admin = await db.user.findOne({ username: "admin" }, FULL_ACCESS);
	await expect(
		// biome-ignore lint/style/noNonNullAssertion: seeded admin
		db.apiKey.delete({ publicId: "does-not-exist" }, { actor: admin! }),
	).rejects.toMatchObject({ code: "not-found" });

	// The generic REST delete is idempotent: NotFound answers 200 `deleted: false`.
	const token = await adminToken(request);
	const res = await request.delete("/api/api-key/does-not-exist", {
		headers: { Authorization: `Bearer ${token}` },
	});
	expect(res.status()).toBe(200);
	expect((await res.json()).deleted).toBe(false);
});
