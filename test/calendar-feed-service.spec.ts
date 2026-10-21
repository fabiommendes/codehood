import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotAllowed } from "@/core/error";
import { db } from "@/db";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { resetDatabase } from "./stories/helpers";

test.beforeEach(resetDatabase);

/// Base64url alphabet, the only characters a feed URL may carry unescaped.
const URL_SAFE = /^[A-Za-z0-9_-]+$/;

test("get returns null for a user who never created a feed", async () => {
	const owner = await persistedUserFactory.create();

	expect(
		await db.calendarFeed.get(owner.username, { actor: owner }),
	).toBeNull();
});

test("rotate creates the feed with a URL-safe token of at least 32 characters, readable back through get", async () => {
	const owner = await persistedUserFactory.create();

	const feed = await db.calendarFeed.rotate(owner.username, { actor: owner });

	expect(feed.username).toBe(owner.username);
	expect(feed.token).toMatch(URL_SAFE);
	expect(feed.token.length).toBeGreaterThanOrEqual(32);
	expect(feed.lastUsedAt).toBeNull();
	const stored = await db.calendarFeed.get(owner.username, { actor: owner });
	expect(stored?.token).toBe(feed.token);
});

test("rotating again replaces the token: the old one resolves to null and the new one to the owner", async () => {
	const owner = await persistedUserFactory.create();
	const first = await db.calendarFeed.rotate(owner.username, { actor: owner });

	const second = await db.calendarFeed.rotate(owner.username, { actor: owner });

	expect(second.token).not.toBe(first.token);
	expect(await db.calendarFeed.resolve(first.token)).toBeNull();
	expect(await db.calendarFeed.resolve(second.token)).toMatchObject({
		username: owner.username,
		name: owner.name,
		role: owner.role,
	});
});

test("remove deletes the feed, and removing a user without a feed does nothing", async () => {
	const owner = await persistedUserFactory.create();
	const opts = { actor: owner };
	const feed = await db.calendarFeed.rotate(owner.username, opts);

	await db.calendarFeed.remove(owner.username, opts);
	await db.calendarFeed.remove(owner.username, opts);

	expect(await db.calendarFeed.get(owner.username, opts)).toBeNull();
	expect(await db.calendarFeed.resolve(feed.token)).toBeNull();
});

test("a student who is not the owner is refused get, rotate and remove", async () => {
	const owner = await persistedUserFactory.create();
	const other = await persistedUserFactory.create();
	await db.calendarFeed.rotate(owner.username, { actor: owner });
	const opts = { actor: other };

	await expect(
		db.calendarFeed.get(owner.username, opts),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.calendarFeed.rotate(owner.username, opts),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.calendarFeed.remove(owner.username, opts),
	).rejects.toBeInstanceOf(NotAllowed);
});

test("an admin who is not the owner is refused get, rotate and remove", async () => {
	const owner = await persistedUserFactory.create();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	await db.calendarFeed.rotate(owner.username, { actor: owner });
	const opts = { actor: admin };

	await expect(
		db.calendarFeed.get(owner.username, opts),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.calendarFeed.rotate(owner.username, opts),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.calendarFeed.remove(owner.username, opts),
	).rejects.toBeInstanceOf(NotAllowed);
});

test("a refused rotate leaves the owner's token untouched", async () => {
	const owner = await persistedUserFactory.create();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const feed = await db.calendarFeed.rotate(owner.username, { actor: owner });

	await db.calendarFeed
		.rotate(owner.username, { actor: admin })
		.catch(() => {});

	const stored = await db.calendarFeed.get(owner.username, { actor: owner });
	expect(stored?.token).toBe(feed.token);
});

test("SYSTEM may get, rotate and remove any user's feed", async () => {
	const owner = await persistedUserFactory.create();

	const feed = await db.calendarFeed.rotate(owner.username, FULL_ACCESS);
	const read = await db.calendarFeed.get(owner.username, FULL_ACCESS);
	await db.calendarFeed.remove(owner.username, FULL_ACCESS);

	expect(read?.token).toBe(feed.token);
	expect(await db.calendarFeed.get(owner.username, FULL_ACCESS)).toBeNull();
});

//
// resolve
//

test("resolve stamps lastUsedAt with the current time", async () => {
	const owner = await persistedUserFactory.create();
	const feed = await db.calendarFeed.rotate(owner.username, { actor: owner });
	expect(feed.lastUsedAt).toBeNull();

	const before = Date.now();
	await db.calendarFeed.resolve(feed.token);
	const after = Date.now();

	const stored = await db.calendarFeed.get(owner.username, { actor: owner });
	expect(stored?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(before);
	expect(stored?.lastUsedAt?.getTime()).toBeLessThanOrEqual(after);
});

test("resolve of a well-formed token nobody holds returns null", async () => {
	await expect(db.calendarFeed.resolve("no-such-token")).resolves.toBeNull();
});

const MALFORMED_TOKENS: [string, string][] = [
	["characters outside the base64url alphabet", "abc def/ghi?"],
	["a path traversal attempt", "../../etc/passwd"],
	["the base64 padding character", "abc="],
	["more than 128 characters", "a".repeat(129)],
	["the empty string", ""],
];

for (const [name, token] of MALFORMED_TOKENS) {
	test(`resolve returns null without throwing for a token with ${name}`, async () => {
		await expect(db.calendarFeed.resolve(token)).resolves.toBeNull();
	});
}

test("deleting the user deletes the feed, so its token stops resolving", async () => {
	const owner = await persistedUserFactory.create();
	const feed = await db.calendarFeed.rotate(owner.username, { actor: owner });

	await db.user.delete({ username: owner.username }, FULL_ACCESS);

	expect(await db.calendarFeed.resolve(feed.token)).toBeNull();
});
