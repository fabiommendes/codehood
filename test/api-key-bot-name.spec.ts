import { expect, test } from "@playwright/test";
import { InvalidData } from "@/core/error";
import { db } from "@/db";
import { persistedUserFactory } from "@/fixtures/user.factory";

/// A BOT key's name becomes the `bot` of every feedback it writes, so it has to be a slug.

async function create(name: string, kind: "BOT" | "CLI") {
	const owner = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	return db.apiKey.create(
		{ name, kind, createdBy: { username: owner.username, name: owner.name } },
		{ actor: owner },
	);
}

for (const name of ["runner", "chalk-2", "a", "0", "a".repeat(40)]) {
	test(`a BOT key named "${name.slice(0, 12)}" (${name.length} chars) is accepted`, async () => {
		const key = await create(name, "BOT");
		expect(key.name).toBe(name);
	});
}

for (const name of [
	"Runner",
	"my runner",
	"runner_1",
	"corretor-é",
	"a".repeat(41),
]) {
	test(`a BOT key named "${name.slice(0, 12)}" (${name.length} chars) is refused`, async () => {
		await expect(create(name, "BOT")).rejects.toBeInstanceOf(InvalidData);
	});
}

test("a CLI key keeps a free-form name", async () => {
	const name = `Meu Laptop (trabalho) ${"x".repeat(60)}`;
	const key = await create(name, "CLI");
	expect(key.name).toBe(name);
});
