import { assertGitVersion } from "./bare";

/// The check of the git binary, made once per process.
let checked: Promise<void> | null = null;

/// Runs the check on the first call and answers every later one with its result.
export function ensureGit(): Promise<void> {
	checked ??= assertGitVersion();
	return checked;
}

const started = Symbol.for("codehood.git.boot");

/**
 * Checks the git binary when the server starts and ends the process with a clear message when it cannot serve repositories.
 *
 * Calling it again does nothing.
 */
export function checkGitAtBoot(): void {
	const scope = globalThis as Record<symbol, unknown>;
	if (scope[started]) return;
	scope[started] = true;
	ensureGit().catch((error: unknown) => {
		const reason = error instanceof Error ? error.message : String(error);
		console.error(`Codehood cannot start: ${reason}`);
		process.exit(1);
	});
}
