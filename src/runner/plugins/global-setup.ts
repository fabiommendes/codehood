/**
 * Builds a runner bundle with the plugins under test and starts the runner
 * test server. With `--project`, only the plugins of those projects go into
 * the bundle, so one plugin's suite does not wait for the others' builds.
 */

import { join, resolve } from "node:path";
import { runnerGlobalSetup } from "@codehood/runner/testing/setup";
import type { RunnerPlugin } from "@codehood/runner-api";
import { elm, javascript, lua, prolog, python, typescript } from ".";

const ALL: Record<string, () => RunnerPlugin> = {
	elm,
	javascript,
	lua,
	prolog,
	python,
	typescript,
};

/// Project names passed as `--project=x` or `--project x`.
function selectedProjects(argv: readonly string[]): string[] {
	const names: string[] = [];
	argv.forEach((arg, i) => {
		if (arg.startsWith("--project="))
			names.push(arg.slice("--project=".length));
		else if (arg === "--project" && argv[i + 1]) names.push(argv[i + 1] ?? "");
	});
	return names;
}

export default function globalSetup(): Promise<() => Promise<void>> {
	const selected = selectedProjects(process.argv);
	const ids = selected.length > 0 ? selected : Object.keys(ALL);
	const root = resolve(import.meta.dirname, "..", "..", "..");
	return runnerGlobalSetup({
		root,
		bundleDir: join(
			root,
			"test",
			".tmp",
			"runner-plugins",
			ids.sort().join("-"),
		),
		plugins: ids.flatMap((id) => {
			const plugin = ALL[id];
			return plugin ? [plugin()] : [];
		}),
	});
}
