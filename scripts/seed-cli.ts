/**
 * Pushes the `pyxel101` seed course to the running dev server with the CLI.
 *
 * Copies `cli/seed/pyxel101/` to `tmp/pyxel101/` (deleted first), points the
 * copy at the live edition and shifts its dates into that edition, then runs
 * `ch push` there as `ada`. It does not seed the database: run `pnpm run
 * db:reset` and `pnpm run dev` first.
 *
 * - `--url <url>`: dev server address (default `http://localhost:4321`)
 */
import { spawn } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
/// Same value as `DEV_ADA_CLI_TOKEN` in `src/db/bootstrap.ts`, which is not
/// imported because loading it pulls in the whole database layer.
const DEV_ADA_CLI_TOKEN = "dev-ada-cli";
const SOURCE = path.join(rootDir, "cli/seed/pyxel101");
const TARGET = path.join(rootDir, "tmp/pyxel101");

const DAY_MS = 86_400_000;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
/// A `holidays:` front matter entry, `Month, Day, Title`, in the calendar.
const HOLIDAY = /^(\s*-\s*)([A-Za-z]{3}),(\s*)(\d{1,2})(,.*)$/gm;

/// Shifts a UTC calendar date by `days`, as `YYYY-MM-DD`.
function shiftIso(iso: string, days: number): string {
	const time = Date.parse(`${iso}T00:00:00Z`);
	if (Number.isNaN(time)) return iso;
	return new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Shifts every ISO date in `text` by `days`, also inside datetimes, and the
 * `Mon, DD, Title` entries of a calendar's `holidays:` list.
 *
 * A holiday has no year, so it takes the one of the calendar's `start:` (the
 * next one when its month comes before the start month).
 *
 * @example
 * shiftDates("start: 2026-08-03", 14) // "start: 2026-08-17"
 */
export function shiftDates(text: string, days: number): string {
	const start = /^start:\s*(\d{4})-(\d{2})/m.exec(text);
	const shifted = text.replace(ISO_DATE, (iso) => shiftIso(iso, days));
	if (!start) return shifted;
	const [startYear, startMonth] = [Number(start[1]), Number(start[2])];
	return shifted.replace(
		HOLIDAY,
		(whole, lead, month, space, day, rest: string) => {
			const index = MONTHS.indexOf(month);
			if (index < 0) return whole;
			const year = index + 1 < startMonth ? startYear + 1 : startYear;
			const iso = `${year}-${String(index + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
			const [, m, d] = shiftIso(iso, days).split("-");
			return `${lead}${MONTHS[Number(m) - 1]},${space}${Number(d)}${rest}`;
		},
	);
}

/// Monday of the week holding `date`, as `YYYY-MM-DD` (UTC).
function mondayOf(date: Date): string {
	const weekday = (date.getUTCDay() + 6) % 7;
	return new Date(date.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

/// Whole weeks, in days, between two ISO dates (rounded to the nearest week).
function weeksBetween(from: string, to: string): number {
	const diff =
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
	return Math.round(diff / 7) * 7;
}

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

/// Slug of the edition whose span holds now, and its start, from the REST API.
async function liveEdition(
	url: string,
): Promise<{ slug: string; startAt: Date }> {
	let response: Response;
	try {
		response = await fetch(`${url}/api/edition`, {
			headers: { Authorization: `Bearer ${DEV_ADA_CLI_TOKEN}` },
		});
	} catch {
		return fail(`no dev server at ${url}. Run \`pnpm run dev\` first.`);
	}
	if (response.status === 401 || response.status === 403) {
		fail(
			`${url} refused the ada token. The database needs \`pnpm run db:reset\` (and a dev server restart).`,
		);
	}
	if (!response.ok) fail(`GET ${url}/api/edition answered ${response.status}`);
	const editions = (await response.json()) as {
		slug: string;
		startAt: string;
		endAt: string;
	}[];
	const now = Date.now();
	const live = editions.find(
		(e) => Date.parse(e.startAt) <= now && now <= Date.parse(e.endAt),
	);
	if (!live)
		fail("no live edition on the server; reseed with `pnpm run db:reset`.");
	return { slug: live.slug, startAt: new Date(live.startAt) };
}

/// Every file under `dir`, recursively.
function filesUnder(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? filesUnder(full) : [full];
	});
}

/// Rewrites a text file in place.
function rewrite(file: string, edit: (text: string) => string): void {
	writeFileSync(file, edit(readFileSync(file, "utf8")));
}

/// Copies the seed course, recreating the target and keeping file modes.
function copyCourse(): void {
	rmSync(TARGET, { recursive: true, force: true });
	mkdirSync(path.dirname(TARGET), { recursive: true });
	cpSync(SOURCE, TARGET, {
		recursive: true,
		preserveTimestamps: true,
		filter: (from) => !CACHE_DIRS.has(path.basename(from)),
	});
	for (const file of filesUnder(TARGET)) {
		const from = path.join(SOURCE, path.relative(TARGET, file));
		chmodSync(file, statSync(from).mode);
	}
}

/// Tool caches left in the seed by running its labs' tests; never copied.
const CACHE_DIRS = new Set(["__pycache__", ".pytest_cache", ".ruff_cache"]);

/// Runs `ch push` in the copy; resolves with its exit code and whether it summarized.
function push(): Promise<{ code: number; summarized: boolean }> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"uv",
			["run", "--project", path.join(rootDir, "cli"), "ch", "push"],
			{
				cwd: TARGET,
				env: { ...process.env, CODEHOOD_TOKEN: DEV_ADA_CLI_TOKEN },
				stdio: ["inherit", "pipe", "pipe"],
			},
		);
		let summarized = false;
		child.stdout.on("data", (chunk: Buffer) => {
			if (/^summary:/m.test(chunk.toString())) summarized = true;
			process.stdout.write(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, summarized }));
	});
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: { url: { type: "string", default: "http://localhost:4321" } },
	});
	const url = (values.url as string).replace(/\/+$/, "");

	const edition = await liveEdition(url);

	copyCourse();
	const toml = path.join(TARGET, "codehood.toml");
	rewrite(toml, (text) =>
		text
			.replace(/^(edition\s*=\s*)".*"$/m, `$1"${edition.slug}"`)
			.replace(/^(url\s*=\s*)".*"$/m, `$1"${url}"`),
	);

	const calendar = path.join(TARGET, "calendar.md");
	const originalStart = /^start:\s*(\d{4}-\d{2}-\d{2})/m.exec(
		readFileSync(calendar, "utf8"),
	)?.[1];
	if (!originalStart) fail("calendar.md has no `start:` date");
	const days = weeksBetween(originalStart, mondayOf(edition.startAt));
	const exams = path.join(TARGET, "exams");
	const toShift = [calendar];
	try {
		toShift.push(...filesUnder(exams));
	} catch {
		// the course has no exams folder
	}
	for (const file of toShift) rewrite(file, (text) => shiftDates(text, days));
	console.log(
		`edition ${edition.slug}, dates shifted by ${days} days, copy at ${TARGET}`,
	);

	// `ch push` exits 1 both when it aborts (unreadable repository, server
	// down, token refused: it prints `error: ...` and no summary) and when the
	// push ran but some operation failed (it prints `summary:` first). Failed
	// operations are the expected measure of what the CLI cannot push yet, so
	// only a push without a summary line counts as aborted.
	const { code, summarized } = await push();

	console.log(`\nCourse copy: ${TARGET}`);
	console.log(
		"Rerun by hand: cd tmp/pyxel101 && CODEHOOD_TOKEN=dev-ada-cli uv run --project ../../cli ch push",
	);
	if (code !== 0 && !summarized) {
		fail(`push aborted (exit ${code})`);
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await main();
}
