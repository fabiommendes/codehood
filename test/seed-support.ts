import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/db/client";
import { TEST_SEEDED_DB_PATH } from "./env";

/// The instructors the dev seed creates; their courses are the ones it fills.
export const SEEDED_INSTRUCTORS = ["ada", "alan", "instructor"];

/// Selects the courses of the seeded instructors in a `Course` filter.
export const seededCourses = { instructorId: { in: SEEDED_INSTRUCTORS } };

/// A private copy of the seeded database, opened for reading.
export interface SeededDatabase {
	/// A client on the copy.
	prisma: PrismaClient;
	/// Where the copy lives, for a child process that opens it itself.
	file: string;
	/// Disconnects and deletes the copy.
	close(): Promise<void>;
}

/**
 * Opens a private copy of the seeded database `test/run.ts` prepares.
 *
 * The worker's own database is shared with the spec files that run before and
 * after, and some of them empty it, so the seed is read from a copy no worker
 * writes to.
 */
export function openSeededDatabase(): SeededDatabase {
	const scratch = mkdtempSync(path.join(tmpdir(), "codehood-seed-"));
	const file = path.join(scratch, "seeded.db");
	copyFileSync(TEST_SEEDED_DB_PATH, file);
	const prisma = new PrismaClient({
		adapter: new PrismaBetterSqlite3({ url: `file:${file}` }),
	});
	return {
		prisma,
		file,
		async close() {
			await prisma.$disconnect();
			rmSync(scratch, { recursive: true, force: true });
		},
	};
}
