/**
 * Compiles the Paraglide messages into `src/generated/paraglide`, unless the
 * messages and settings are unchanged since the last run. Pass `--force` to
 * compile anyway.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@inlang/paraglide-js";
import { inputsStamp } from "./lib/inputs-stamp";
import { paraglideOptions } from "./lib/paraglide";

const root = fileURLToPath(new URL("..", import.meta.url));
const options = paraglideOptions(root);
const paraglideVersion: string = JSON.parse(
	readFileSync(
		path.join(root, "node_modules/@inlang/paraglide-js/package.json"),
		"utf8",
	),
).version;
const stamp = inputsStamp(
	path.join(options.outdir, ".inputs-hash"),
	{
		paths: [
			path.join(root, "messages"),
			path.join(options.project, "settings.json"),
		],
		extra: { options, version: paraglideVersion },
	},
	[
		path.join(options.outdir, "messages.js"),
		path.join(options.outdir, "runtime.js"),
	],
);

if (stamp.fresh && !process.argv.includes("--force")) {
	console.log("Paraglide messages are up to date");
} else {
	await compile(options);
	stamp.write();
}
