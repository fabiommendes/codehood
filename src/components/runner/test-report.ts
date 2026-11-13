/**
 * Pure helpers of `runTests`: find where a test case is defined in its
 * source, and turn the JSON a driver writes in `test` mode into report cases.
 */

import type { ReportCase } from "./run-tests";

/// A string literal: its content, escapes included, in group 1.
const STRING = '"((?:[^"\\\\\\n]|\\\\.)*)"';

/// A test definition and the literal that names it.
const CASE = new RegExp(
	`\\b(?:test|todo|fuzz\\d?|fuzzWith)\\b[^"\\n]*?${STRING}`,
	"g",
);

/// A `describe` and the literal that names it.
const DESCRIBE = new RegExp(`\\bdescribe\\s+${STRING}`, "g");

/// What the escapes Elm string literals use in test names stand for.
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

/// The text a literal's source stands for.
function unescapeLiteral(text: string): string {
	return text.replace(/\\(.)/g, (_, char: string) => ESCAPES[char] ?? char);
}

/**
 * The 1-based line of the literal `test "<name>"` (or `fuzz*`, `todo`) that
 * defines the test at the end of `labels`, or undefined when it is not found.
 *
 * `labels` is the path of descriptions, outermost first, the test name last.
 * When several tests share the name, the one after the `describe` that is the
 * test's parent wins; the first one otherwise.
 */
export function locateElmCase(
	text: string,
	labels: readonly string[],
): number | undefined {
	const name = labels[labels.length - 1];
	const parent = labels.length > 1 ? labels[labels.length - 2] : undefined;
	const found: { line: number; describe: string | undefined }[] = [];
	let describe: string | undefined;
	for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
		for (const match of line.matchAll(DESCRIBE)) {
			describe = unescapeLiteral(match[1] ?? "");
		}
		for (const match of line.matchAll(CASE)) {
			if (unescapeLiteral(match[1] ?? "") === name) {
				found.push({ line: index + 1, describe });
			}
		}
	}
	if (found.length > 1 && parent !== undefined) {
		const exact = found.find((f) => f.describe === parent);
		if (exact) return exact.line;
	}
	return found[0]?.line;
}

/// One case of the JSON `Codehood.Test.Runner.runJson` writes.
interface SuiteCase {
	labels: string[];
	verdict: "pass" | "fail" | "skipped";
	message?: string;
	expected?: string;
	actual?: string;
}

/// The JSON `Codehood.Test.Runner.runJson` writes.
type Suite = { cases: SuiteCase[] } | { invalid: string };

/**
 * Parses the stdout of a `test` run of the Elm driver.
 *
 * @returns the cases, or `invalid` with the reason when the suite itself is
 *   not valid (duplicate names, empty `describe`); `null` when the text is
 *   not the driver's JSON.
 */
export function parseSuite(
	stdout: string,
): { cases: SuiteCase[] } | { invalid: string } | null {
	try {
		const suite = JSON.parse(stdout) as Suite;
		if (Array.isArray((suite as { cases?: unknown }).cases)) return suite;
		if (typeof (suite as { invalid?: unknown }).invalid === "string") {
			return suite;
		}
	} catch {
		// Not JSON.
	}
	return null;
}

/** Report cases of the suite that `text`, the test source `source`, defines. */
export function elmCases(
	source: number,
	text: string,
	cases: readonly SuiteCase[],
): ReportCase[] {
	return cases.map((c) => {
		const line = locateElmCase(text, c.labels);
		return {
			source,
			...(line === undefined ? {} : { line }),
			verdict: c.verdict,
			id: c.labels.join(" > "),
			...(c.message === undefined ? {} : { message: c.message }),
			...(c.expected === undefined ? {} : { expected: c.expected }),
			...(c.actual === undefined ? {} : { actual: c.actual }),
		};
	});
}

/// The module a source declares, or null when it has no header.
export function elmModule(text: string): string | null {
	const match = /^(?:port\s+|effect\s+)?module\s+([A-Z][\w.]*)/m.exec(text);
	return match?.[1] ?? null;
}

/** Removes the ANSI escapes the compiler uses for color. */
export function stripAnsi(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}
