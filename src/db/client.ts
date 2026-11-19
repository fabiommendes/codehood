import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { instrumentAdapter } from "@/perf/sqlite";
import {
	PrismaClient,
	Prisma as PrismaRuntime,
} from "../generated/prisma/client";

export type {
	ApiKey,
	ApiKeyKind,
	Attachment,
	Blob,
	CalendarEvent,
	Course,
	Discipline,
	Edition,
	Enrollment,
	EnrollmentStatus,
	EventKind,
	Exam,
	ExamStatus,
	Invite,
	InviteKind,
	Passphrase,
	Prisma,
	Resource,
	ResourceType,
	Role,
	Session,
	TimeSlot,
	User,
	Weekday,
} from "../generated/prisma/client";
export { PrismaClient } from "../generated/prisma/client";

/// Writes SQL `NULL` to an optional `Json` column, where a plain `null` is refused.
export const DbNull = PrismaRuntime.DbNull;

/// Writes JSON `null` to a required `Json` column, where a plain `null` is refused.
export const JsonNull = PrismaRuntime.JsonNull;

type PrismaTxFn = Parameters<PrismaClient["$transaction"]>[0];
export type PrismaTx = Parameters<PrismaTxFn>[0];

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/// The journal modes `DATABASE_JOURNAL_MODE` accepts, each with the `synchronous` level it runs at.
///
/// In WAL a commit appends to the `-wal` file and the fsync is left to the checkpoint: a power loss may drop the last commits, never corrupt the file. `delete` is the rollback journal with an fsync per commit.
const JOURNAL_PRAGMAS = {
	wal: "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
	delete: "PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;",
} as const;

/**
 * The pragmas every connection starts with, from `DATABASE_JOURNAL_MODE` (`wal` when unset or blank).
 *
 * @throws {Error} If the variable holds anything but `wal` or `delete`.
 */
function journalPragmas(): string {
	const mode = process.env.DATABASE_JOURNAL_MODE?.trim().toLowerCase() || "wal";
	if (mode !== "wal" && mode !== "delete") {
		throw new Error(
			`DATABASE_JOURNAL_MODE must be "wal" or "delete", got "${mode}"`,
		);
	}
	return JOURNAL_PRAGMAS[mode];
}

/// Makes every connection of `factory` run `pragmas` before its first statement.
function withPragmas<
	F extends {
		connect: () => Promise<{ executeScript: (sql: string) => Promise<void> }>;
	},
>(factory: F, pragmas: string): F {
	const connect = factory.connect.bind(factory);
	factory.connect = async () => {
		const connection = await connect();
		await connection.executeScript(pragmas);
		return connection;
	};
	return factory;
}

const adapter = instrumentAdapter(
	withPragmas(
		new PrismaBetterSqlite3({
			url: process.env.DATABASE_URL ?? "file:./dev.db",
		}),
		journalPragmas(),
	),
);

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

// We inject the prisma client into the global object to use in tests.
if (process.env.NODE_ENV !== "production") {
	globalForPrisma.prisma = prisma;
}
