/**
 * Pins codehood to the current HEAD of `../mdq`.
 *
 * Usage: `pnpm run mdq:bump`
 *
 * Refuses when mdq-js, mdq-py or schema have uncommitted changes or HEAD is
 * not on a remote branch (it runs `git fetch origin` first). Otherwise writes
 * the SHA to `.mdq-ref` and rebuilds `mdq-js`. Commit `.mdq-ref` afterwards.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
	MDQ_DIR,
	MDQ_REF_FILE,
	mdqDirty,
	mdqFetch,
	mdqHead,
	mdqPushed,
} from "./lib/mdq-snapshot";

function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

const head = mdqHead();
if (head === null) fail(`${MDQ_DIR} is not a git checkout of mdq-spec.`);
const dirty = mdqDirty();
if (dirty.length > 0) {
	fail(`../mdq has uncommitted changes:\n  ${dirty.join("\n  ")}`);
}
if (!mdqFetch()) fail("git fetch origin failed in ../mdq.");
if (!mdqPushed(head))
	fail(`../mdq ${head} is not on a remote branch. Push it.`);

for (const command of [["install", "--frozen-lockfile"], ["build"]]) {
	const { status } = spawnSync("pnpm", command, {
		cwd: path.join(MDQ_DIR, "mdq-js"),
		stdio: "inherit",
		// CI=true keeps pnpm from waiting on a prompt that has no TTY to answer.
		env: { ...process.env, CI: "true" },
		timeout: 5 * 60_000,
	});
	if (status !== 0) fail(`pnpm ${command.join(" ")} failed in ../mdq/mdq-js.`);
}

writeFileSync(MDQ_REF_FILE, `${head}\n`);
console.log(`.mdq-ref: ${head}`);
