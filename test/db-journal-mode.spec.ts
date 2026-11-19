import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { prisma } from "@/db/client";

/// The value of `PRAGMA <name>` on the connection of `client`.
async function pragma(name: string): Promise<string> {
	const [row] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
		`PRAGMA ${name}`,
	);
	return String(Object.values(row ?? {})[0]);
}

/// Opens a new database through `src/db/client.ts` in a fresh process and prints its journal mode and `synchronous`.
function pragmasWith(vars: Record<string, string>): string {
	const dir = mkdtempSync(path.join(tmpdir(), "codehood-journal-"));
	try {
		return execFileSync(
			"node_modules/.bin/tsx",
			[
				"-e",
				`import("@/db/client").then(async ({ prisma }) => {
					const value = async (name) => String(Object.values((await prisma.$queryRawUnsafe("PRAGMA " + name))[0])[0]);
					console.log(await value("journal_mode"), await value("synchronous"));
					await prisma.$disconnect();
				});`,
			],
			{
				env: {
					...process.env,
					DATABASE_URL: `file:${path.join(dir, "probe.db")}`,
					...vars,
				},
				encoding: "utf8",
			},
		).trim();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("the database is opened in WAL with synchronous NORMAL", async () => {
	expect(await pragma("journal_mode")).toBe("wal");
	// 1 is NORMAL: a commit appends to the WAL and leaves the fsync to the checkpoint.
	expect(await pragma("synchronous")).toBe("1");
});

test("DATABASE_JOURNAL_MODE=delete keeps the rollback journal with synchronous FULL", () => {
	expect(pragmasWith({ DATABASE_JOURNAL_MODE: "delete" })).toBe("delete 2");
});

test("an unset or blank DATABASE_JOURNAL_MODE means WAL", () => {
	expect(pragmasWith({ DATABASE_JOURNAL_MODE: "" })).toBe("wal 1");
});

test("an unknown DATABASE_JOURNAL_MODE stops the server from starting", () => {
	expect(() => pragmasWith({ DATABASE_JOURNAL_MODE: "fast" })).toThrow(
		/DATABASE_JOURNAL_MODE/,
	);
});
