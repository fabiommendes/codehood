import { createRequire } from "node:module";
import path from "node:path";

/// A value better-sqlite3 binds to a parameter.
export type SqlValue = string | number | bigint | Buffer | null;

export interface Statement {
	run(...params: SqlValue[]): unknown;
	get(...params: SqlValue[]): unknown;
	all(...params: SqlValue[]): unknown[];
}

/// The part of a better-sqlite3 connection the fill uses.
export interface Sqlite {
	prepare(sql: string): Statement;
	exec(sql: string): void;
	pragma(source: string): unknown;
	close(): void;
}

/** The file path of a `file:` database URL, as `DATABASE_URL` spells it. */
export function databasePath(url: string): string {
	if (!url.startsWith("file:"))
		throw new Error(`Expected a "file:" database URL, got "${url}".`);
	const file = url.slice("file:".length).replace(/^\/\/(?=\/)/, "");
	return path.resolve(file.split("?")[0] ?? file);
}

/**
 * Opens a database with the better-sqlite3 the Prisma adapter depends on.
 *
 * The package is not a direct dependency, so it is resolved from the adapter.
 *
 * @throws Error when the file does not exist.
 */
export function openSqlite(file: string): Sqlite {
	const fromHere = createRequire(import.meta.url);
	const fromAdapter = createRequire(
		fromHere.resolve("@prisma/adapter-better-sqlite3"),
	);
	const Database = fromAdapter("better-sqlite3") as new (
		file: string,
		options: { fileMustExist: boolean },
	) => Sqlite;
	return new Database(file, { fileMustExist: true });
}

/// A function that inserts one row, its values in the order of the columns.
export type Insert = (...values: SqlValue[]) => void;

/** Prepares the insert of one table and counts its rows under the table's name in `counts`. */
export function inserter(
	db: Sqlite,
	counts: Record<string, number>,
	table: string,
	columns: readonly string[],
): Insert {
	const statement = db.prepare(
		`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
	);
	counts[table] ??= 0;
	return (...values) => {
		statement.run(...values);
		counts[table] = (counts[table] ?? 0) + 1;
	};
}

/** The last id an autoincrement table handed out, deleted rows included. */
export function lastId(db: Sqlite, table: string): number {
	const max = db
		.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM "${table}"`)
		.get() as { id: number };
	const sequence = db
		.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
		.get(table) as { seq: number } | undefined;
	return Math.max(max.id, sequence?.seq ?? 0);
}
