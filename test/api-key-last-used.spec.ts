import { expect, test } from "@playwright/test";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { LAST_USED_RESOLUTION_MS } from "@/db/services/api-key.service";
import { persistedUserFactory } from "@/fixtures/user.factory";

/// A bot validates its key on every request, so the stamp is written sparingly.

async function botKey() {
	const owner = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const key = await db.apiKey.create(
		{
			name: "runner",
			kind: "BOT",
			createdBy: { username: owner.username, name: owner.name },
		},
		{ actor: owner },
	);
	const lastUsedAt = async () =>
		(await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } }))
			.lastUsedAt;
	const usedAt = (lastUsedAt: Date) =>
		prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt } });
	return { token: key.token as string, lastUsedAt, usedAt };
}

test("the first use of a key stamps it", async () => {
	const key = await botKey();
	const before = Date.now();

	expect(await db.apiKey.validate(key.token)).not.toBeNull();

	expect((await key.lastUsedAt())?.getTime()).toBeGreaterThanOrEqual(before);
});

test("a key used again within the resolution keeps its stamp and still validates", async () => {
	const key = await botKey();
	const recent = new Date(Date.now() - LAST_USED_RESOLUTION_MS / 2);
	await key.usedAt(recent);

	expect(await db.apiKey.validate(key.token)).not.toBeNull();

	expect(await key.lastUsedAt()).toEqual(recent);
});

test("a key whose stamp is older than the resolution is stamped again", async () => {
	const key = await botKey();
	const stale = new Date(Date.now() - LAST_USED_RESOLUTION_MS - 1000);
	await key.usedAt(stale);

	await db.apiKey.validate(key.token);

	expect((await key.lastUsedAt())?.getTime()).toBeGreaterThan(stale.getTime());
});
