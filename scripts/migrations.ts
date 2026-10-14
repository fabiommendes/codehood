/**
 * Writes the migration that brings `prisma/migrations/` up to
 * `prisma/schema.prisma`, and checks the pending ones for data loss.
 *
 * Development tracks the schema with `db push`, so migrations are written
 * only when a release is cut, one per release, instead of one per change.
 *
 * - no flag: write the missing migration, if any, then check
 * - `--name <name>`: suffix of the new migration directory (default `release`)
 * - `--check`: fail if the migrations do not match the schema, write nothing
 * - `--allow-data-loss`: accept pending migrations that drop tables or columns
 *
 * "Pending" means not committed to git yet. Each one is replayed in a scratch
 * SQLite database on top of the committed ones, which proves the SQL runs and
 * shows which tables and columns it drops. A pending migration may be edited
 * by hand (to copy data out of a renamed column, say) and checked again.
 */
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const MIGRATIONS_DIR = "prisma/migrations";
const SCHEMA = "prisma/schema.prisma";

const { values: args } = parseArgs({
	options: {
		name: { type: "string", default: "release" },
		check: { type: "boolean", default: false },
		"allow-data-loss": { type: "boolean", default: false },
	},
});

/// The SQL that takes the migrations to the schema, empty when they match.
function pendingDiff(): string {
	const result = spawnSync(
		"pnpm",
		[
			"exec",
			"prisma",
			"migrate",
			"diff",
			"--from-migrations",
			MIGRATIONS_DIR,
			"--to-schema",
			SCHEMA,
			"--script",
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		process.stderr.write(result.stderr);
		throw new Error("prisma migrate diff failed");
	}
	const sql = result.stdout.trim();
	return sql === "-- This is an empty migration." ? "" : sql;
}

/// Migration directories, oldest first.
function migrationDirs(): string[] {
	return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

/// Migration directories git does not track yet.
function uncommittedDirs(): Set<string> {
	const result = spawnSync(
		"git",
		["ls-files", "--others", "--modified", "--", MIGRATIONS_DIR],
		{ encoding: "utf8" },
	);
	const dirs = result.stdout
		.split("\n")
		.filter(Boolean)
		.map((file) => file.slice(MIGRATIONS_DIR.length + 1).split("/")[0] ?? "");
	return new Set(dirs);
}

/// UTC timestamp in Prisma's migration directory format.
function timestamp(): string {
	return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/// Splits a Prisma-generated script into statements, dropping comment lines.
function statements(sql: string): string[] {
	return sql
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("--"))
		.join("\n")
		.split(/;\s*\n/)
		.map((statement) => statement.trim().replace(/;$/, ""))
		.filter(Boolean);
}

function unquote(identifier: string): string {
	return identifier.replace(/^["`]|["`]$/g, "");
}

function columnsOf(db: DatabaseSync, table: string): string[] {
	const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as {
		name: string;
	}[];
	return rows.map((row) => row.name);
}

/// Columns a row must give a value for: NOT NULL, no default, not the rowid.
function requiredColumnsOf(db: DatabaseSync, table: string): string[] {
	const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as {
		name: string;
		type: string;
		notnull: number;
		dflt_value: string | null;
		pk: number;
	}[];
	return rows
		.filter((row) => row.notnull === 1 && row.dflt_value === null)
		.filter((row) => !(row.pk === 1 && row.type.toUpperCase() === "INTEGER"))
		.map((row) => row.name);
}

/**
 * Replays `sql` statement by statement and returns what it would destroy in a
 * database that holds data.
 */
function replay(db: DatabaseSync, sql: string): string[] {
	const losses: string[] = [];
	const redefined = new Set<string>();
	for (const statement of statements(sql)) {
		// SQLite cannot alter most columns, so Prisma rebuilds the table:
		// CREATE "new_X", INSERT INTO "new_X" (cols) SELECT cols FROM "X",
		// DROP "X", RENAME "new_X" TO "X". A column of X missing from the
		// INSERT is dropped with its data.
		const copy = statement.match(
			/^INSERT INTO "new_(\w+)" \(([^)]*)\) SELECT .* FROM "(\w+)"$/s,
		);
		if (copy?.[1] && copy[2] !== undefined && copy[3]) {
			redefined.add(copy[3]);
			const kept = new Set(copy[2].split(",").map((c) => unquote(c.trim())));
			for (const column of columnsOf(db, copy[3])) {
				if (!kept.has(column)) losses.push(`drops column ${copy[3]}.${column}`);
			}
			for (const column of requiredColumnsOf(db, `new_${copy[1]}`)) {
				if (!kept.has(column)) {
					losses.push(
						`fails if ${copy[3]} has rows: ${column} is required and has no default`,
					);
				}
			}
		}
		const drop = statement.match(/^DROP TABLE "(\w+)"$/);
		if (drop?.[1] && !redefined.has(drop[1])) {
			losses.push(`drops table ${drop[1]}`);
		}
		const dropColumn = statement.match(
			/^ALTER TABLE "(\w+)" DROP COLUMN "(\w+)"$/,
		);
		if (dropColumn) {
			losses.push(`drops column ${dropColumn[1]}.${dropColumn[2]}`);
		}
		db.exec(statement);
	}
	return losses;
}

/// Checks the pending migrations and returns whether they may be released.
function checkPending(): boolean {
	const pending = uncommittedDirs();
	const scratch = mkdtempSync(join(tmpdir(), "codehood-migrations-"));
	const db = new DatabaseSync(join(scratch, "replay.db"));
	let ok = true;
	try {
		for (const dir of migrationDirs()) {
			const sql = readFileSync(
				join(MIGRATIONS_DIR, dir, "migration.sql"),
				"utf8",
			);
			if (!pending.has(dir)) {
				db.exec(sql);
				continue;
			}
			let losses: string[];
			try {
				losses = replay(db, sql);
			} catch (error) {
				console.error(`✖ ${dir}: does not run: ${(error as Error).message}`);
				ok = false;
				break;
			}
			if (losses.length === 0) {
				console.log(`✔ ${dir}: no data loss`);
				continue;
			}
			const marker = args["allow-data-loss"] ? "⚠" : "✖";
			console.log(`${marker} ${dir}:`);
			for (const loss of losses) console.log(`    ${loss}`);
			if (!args["allow-data-loss"]) ok = false;
		}
	} finally {
		db.close();
		rmSync(scratch, { recursive: true, force: true });
	}
	if (!ok && !args["allow-data-loss"]) {
		console.error(
			"\nReview the SQL. Edit the migration to keep the data, or rerun with --allow-data-loss.",
		);
	}
	return ok;
}

const diff = pendingDiff();

if (args.check) {
	if (diff) {
		console.error("✖ Migrations do not match the schema. Missing SQL:\n");
		console.error(diff);
		process.exit(1);
	}
	process.exit(checkPending() ? 0 : 1);
}

if (diff) {
	const dir = join(MIGRATIONS_DIR, `${timestamp()}_${args.name}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "migration.sql"), `${diff}\n`);
	console.log(`▶ Wrote ${dir}/migration.sql`);
	if (pendingDiff()) {
		console.error("✖ The new migration does not reproduce the schema.");
		process.exit(1);
	}
} else {
	console.log("▶ Migrations match the schema");
}

process.exit(checkPending() ? 0 : 1);
