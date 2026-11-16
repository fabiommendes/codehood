/**
 * Checks that the sibling repository `../mdq` is the one codehood is pinned to.
 *
 * Usage: `tsx scripts/check-siblings.ts [--strict] [--ci] [--fetch]`
 *
 * - `.mdq-ref` holds the mdq commit codehood is built and tested against.
 *   `../mdq` must be at it, with mdq-js, mdq-py and schema clean, the commit
 *   pushed, `mdq-js/dist/.build-sha` equal to `.mdq-ref` and not `-dirty`, and the
 *   mdq-js, mdq-py and schema versions and the CLI's `mdq>=` bound sharing
 *   MAJOR.MINOR.
 * - Default (lenient): problems are printed as warnings and the exit code is
 *   0. It is what `pnpm run lint` runs, since local work often has mdq ahead
 *   and unpushed.
 * - `--strict`: any problem exits 1. `pnpm run release` and CI use it.
 * - `--ci`: `--strict` without the pushed check, since a CI checkout comes
 *   from the remote and has no remote-tracking branches.
 * - `--fetch`: runs `git fetch origin` in `../mdq` first, so the pushed check
 *   does not rely on a stale remote-tracking branch.
 *
 * `pnpm run mdq:bump` moves `.mdq-ref` to the current `../mdq` HEAD.
 */
import { parseArgs } from "node:util";
import {
	MDQ_DIR,
	mdqBuildStamp,
	mdqDirty,
	mdqFetch,
	mdqHead,
	mdqPushed,
	mdqVersions,
	readMdqRef,
} from "./lib/mdq-snapshot";
import { mdqProblems } from "./lib/siblings";

const { values: args } = parseArgs({
	options: {
		strict: { type: "boolean", default: false },
		ci: { type: "boolean", default: false },
		fetch: { type: "boolean", default: false },
	},
});
const strict = args.strict || args.ci;

const head = mdqHead();
if (head === null) {
	console.error(
		`${MDQ_DIR} is not a git checkout of mdq-spec. Clone it next to this repository.`,
	);
	process.exit(strict ? 1 : 0);
}
if (args.fetch && !mdqFetch()) console.warn("warning: git fetch failed.");

const problems = mdqProblems({
	ref: readMdqRef(),
	head,
	dirty: mdqDirty(),
	pushed: args.ci ? null : mdqPushed(head),
	buildStamp: mdqBuildStamp(),
	versions: mdqVersions(),
});

if (problems.length === 0) {
	console.log(`mdq: ${head.slice(0, 12)} ok`);
} else {
	const label = strict ? "error" : "warning";
	for (const problem of problems) console.error(`${label}: mdq: ${problem}`);
	if (strict) process.exit(1);
}
