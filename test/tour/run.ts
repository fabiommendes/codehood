/**
 * Runs the tour of every screen and checks that nothing was left out.
 *
 * Opens every page each role reaches by following links, saves screenshots and
 * an ARIA snapshot of each under `tmp/tour/<time>/`, then fails when a page
 * route was reached by no role, and lists the `.astro` files the server never
 * rendered.
 *
 * Usage: `pnpm run test:tour [--no-coverage] [playwright args]`
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	globSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import {
	TOUR_IGNORED_PREFIXES,
	TOUR_ROLES,
	TOUR_SKIPPED,
	type TourVisit,
} from "./config";
import { readServerCoverage } from "./coverage";
import { discoverRoutes, PAGES_DIR } from "./routes";

const ROOT = process.cwd();
const TOURS_DIR = path.join(ROOT, "tmp", "tour");
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
const tourDir = path.join(TOURS_DIR, stamp);
const coverageDir = path.join(tourDir, ".coverage");

const args = process.argv.slice(2);
const withCoverage = !args.includes("--no-coverage");
const forwarded = args.filter((arg) => arg !== "--no-coverage");
if (!forwarded.some((arg) => arg.startsWith("--reporter"))) {
	forwarded.push("--reporter=line");
}

const run = spawnSync(
	"node_modules/.bin/tsx",
	["test/run.ts", "--scope=e2e", ...forwarded],
	{
		stdio: "inherit",
		env: {
			...process.env,
			TEST_TOUR: "1",
			TOUR_DIR: tourDir,
			...(withCoverage ? { COVERAGE: "1", NODE_V8_COVERAGE: coverageDir } : {}),
		},
	},
);

const latest = path.join(TOURS_DIR, "latest");
rmSync(latest, { force: true });
symlinkSync(stamp, latest);

// Pages ---------------------------------------------------------------------

const visits: TourVisit[] = TOUR_ROLES.flatMap((role) => {
	const file = path.join(tourDir, role.name, "visits.json");
	return existsSync(file)
		? (JSON.parse(readFileSync(file, "utf8")) as TourVisit[])
		: [];
});
writeFileSync(
	path.join(tourDir, "index.json"),
	`${JSON.stringify(visits, null, "\t")}\n`,
);

const ignoredFiles = Object.keys(TOUR_IGNORED_PREFIXES).map((prefix) =>
	path.join(PAGES_DIR, prefix),
);
const isIgnored = (file: string) =>
	ignoredFiles.some(
		(dir) => file.startsWith(`${dir}/`) || file === `${dir}.astro`,
	);

const pages = discoverRoutes().filter(
	(route) => route.kind === "page" && !isIgnored(route.file),
);
const rolesByRoute = new Map<string, Set<string>>();
for (const visit of visits) {
	// A route that only redirects is reached when the crawl asks for it.
	for (const route of new Set([visit.route, visit.requestedRoute])) {
		if (!route) continue;
		const roles = rolesByRoute.get(route) ?? new Set();
		roles.add(visit.role);
		rolesByRoute.set(route, roles);
	}
}
const missing = pages.filter(
	(route) =>
		!rolesByRoute.has(route.pattern) && !(route.pattern in TOUR_SKIPPED),
);

const lines = [
	`# Tour ${stamp}`,
	"",
	`${visits.length} pages opened. Screenshots and ARIA snapshots: \`<role>/<route>/\`.`,
	"",
	"| Route | File | Roles |",
	"| :---- | :--- | :---- |",
	...pages.map((route) => {
		const roles = [...(rolesByRoute.get(route.pattern) ?? [])].join(", ");
		const note = TOUR_SKIPPED[route.pattern];
		return `| \`${route.pattern}\` | \`${route.file}\` | ${roles || (note ? `skipped: ${note}` : "**not reached**")} |`;
	}),
];

// Components ----------------------------------------------------------------

/// Source files that import `file`, found by its path in an import.
function importersOf(file: string, sources: Map<string, string>): string[] {
	const name = path.basename(file);
	return [...sources]
		.filter(([other, text]) => other !== file && text.includes(`/${name}"`))
		.map(([other]) => other);
}

/** A file the tour never saw rendered, and who imports it. */
interface Unrendered {
	file: string;
	importers: string[];
}

let gaps: Unrendered[] = [];
if (withCoverage && existsSync(coverageDir)) {
	const { ran } = readServerCoverage(coverageDir, ROOT);
	const sources = new Map(
		globSync("src/**/*.{astro,ts,tsx}", { cwd: ROOT }).map((file) => [
			file,
			readFileSync(file, "utf8"),
		]),
	);
	const astro = [...sources.keys()]
		.filter((file) => file.endsWith(".astro") && !isIgnored(file))
		.sort();
	const unrendered = astro
		.filter((file) => !ran.has(file))
		.map((file) => ({ file, importers: importersOf(file, sources) }));
	// Pages are checked by route above; a component counts when product code uses it.
	gaps = unrendered.filter((entry) =>
		entry.importers.some((importer) => !isIgnored(importer)),
	);
	const designOnly = unrendered.filter(
		(entry) => entry.importers.length > 0 && !gaps.includes(entry),
	);
	const unused = unrendered.filter(
		(entry) =>
			entry.importers.length === 0 && !entry.file.startsWith(PAGES_DIR),
	);
	writeFileSync(
		path.join(tourDir, "coverage.json"),
		`${JSON.stringify(
			{
				rendered: astro.filter((file) => ran.has(file)),
				neverRendered: gaps,
				onlyInIgnoredPages: designOnly,
				notImported: unused.map((entry) => entry.file),
			},
			null,
			"\t",
		)}\n`,
	);
	const item = (entry: Unrendered) =>
		`- \`${entry.file}\`${entry.importers.length ? ` — used by ${entry.importers.map((file) => `\`${file}\``).join(", ")}` : ""}`;
	lines.push(
		"",
		`## Components never rendered (${gaps.length} of ${astro.length} .astro files)`,
		"",
		...gaps.map(item),
		"",
		`## Used only by ignored pages (${designOnly.length})`,
		"",
		...designOnly.map(item),
		"",
		`## Imported by nothing (${unused.length})`,
		"",
		...unused.map(item),
	);
	// `TOUR_KEEP_COVERAGE=1` keeps the raw V8 files, to debug the mapping.
	if (!process.env.TOUR_KEEP_COVERAGE) {
		rmSync(coverageDir, { recursive: true, force: true });
	}
}

writeFileSync(path.join(tourDir, "summary.md"), `${lines.join("\n")}\n`);

console.log(
	`\n[tour] ${visits.length} pages, written to ${path.relative(ROOT, tourDir)}`,
);
if (withCoverage) {
	console.log(
		`[tour] ${gaps.length} components never rendered (details in summary.md):`,
	);
	for (const gap of gaps) console.log(`  ${gap.file}`);
}
if (missing.length > 0) {
	console.error(
		"[tour] page routes no role reached (link to them, add a start URL to a role, or skip them in test/tour/config.ts):",
	);
	for (const route of missing)
		console.error(`  ${route.pattern}  (${route.file})`);
}

process.exit(run.status !== 0 ? (run.status ?? 1) : missing.length > 0 ? 1 : 0);
