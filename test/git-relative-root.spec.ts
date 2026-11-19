import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { GitResult } from "./git-server";

/// The push rules under a relative `storage.repositoryRoot`. The root is read
/// once per process, so the pushes run in a child started with another value.

type Pushes = { feature: GitResult; main: GitResult };

function pushUnderRoot(root: string): Promise<Pushes> {
	return new Promise((resolve, reject) => {
		execFile(
			path.resolve("node_modules/.bin/tsx"),
			["test/git-relative-root-child.ts"],
			{ env: { ...process.env, REPOSITORY_ROOT: root } },
			(error, stdout, stderr) => {
				if (error) reject(new Error(`${error.message}\n${stderr}`));
				else resolve(JSON.parse(stdout.trim().split("\n").at(-1) as string));
			},
		);
	});
}

test("a relative repository root still runs the push hook", async () => {
	// Inside the project: a path that climbs to the filesystem root resolves
	// to the same folder from anywhere, and would hide the difference.
	const parent = path.resolve("test/.tmp");
	mkdirSync(parent, { recursive: true });
	const absolute = mkdtempSync(path.join(parent, "relative-root-"));
	try {
		const relative = path.relative(process.cwd(), absolute);
		expect(relative.startsWith("..")).toBe(false);

		const { feature, main } = await pushUnderRoot(relative);

		expect(feature.code).not.toBe(0);
		expect(feature.stderr).toContain("remote: MSG-WRONG-REF");
		expect(main.code, main.stderr).toBe(0);
	} finally {
		rmSync(absolute, { recursive: true, force: true });
	}
});
