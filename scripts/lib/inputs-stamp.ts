/**
 * Skips a code generation step when none of its inputs changed since the last
 * run, by comparing a hash of the inputs with the one stored in a stamp file.
 */
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

/** Files and values whose change requires the step to run again. */
export interface StampInputs {
	/// Files or directories (walked recursively) read by the step.
	paths: string[];
	/// Paths under `paths` that are outputs of the step, not inputs.
	exclude?: string[];
	/// Anything else that changes the output, such as compiler options.
	extra?: unknown;
}

/** A generation step guarded by a stamp file. */
export interface InputsStamp {
	/// True when the stamp matches the inputs and every output exists.
	fresh: boolean;
	/// Records the current inputs; call after the step succeeds.
	write(): void;
}

/**
 * Hashes `inputs` and compares the result with the hash stored at `stampPath`.
 *
 * @example
 * const stamp = inputsStamp("out/.stamp", { paths: ["src"] }, ["out/index.js"]);
 * if (!stamp.fresh) { generate(); stamp.write(); }
 */
export function inputsStamp(
	stampPath: string,
	inputs: StampInputs,
	outputs: string[],
): InputsStamp {
	const excluded = new Set((inputs.exclude ?? []).map((p) => path.resolve(p)));
	const hash = createHash("sha256");
	hash.update(JSON.stringify(inputs.extra ?? null));
	for (const file of inputs.paths.flatMap((p) => listFiles(p, excluded))) {
		hash.update(`\0${file}\0`);
		hash.update(readFileSync(file));
	}
	const digest = hash.digest("hex");
	const stored = existsSync(stampPath)
		? readFileSync(stampPath, "utf8").trim()
		: null;
	return {
		fresh: stored === digest && outputs.every((out) => existsSync(out)),
		write() {
			mkdirSync(path.dirname(stampPath), { recursive: true });
			writeFileSync(stampPath, `${digest}\n`);
		},
	};
}

/// Sorted absolute paths of the files at or under `target`; none when missing.
function listFiles(target: string, excluded: Set<string>): string[] {
	const abs = path.resolve(target);
	if (excluded.has(abs) || !existsSync(abs)) return [];
	if (!statSync(abs).isDirectory()) return [abs];
	return readdirSync(abs, { withFileTypes: true, recursive: true })
		.filter((e) => e.isFile())
		.map((e) => path.join(e.parentPath, e.name))
		.filter((file) => !excluded.has(file))
		.sort();
}
