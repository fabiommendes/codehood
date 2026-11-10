/**
 * Turns the compiler's JSON report (`--report=json`) into terminal text and
 * editor diagnostics.
 */

import type { Diagnostic } from "../../../protocol";

/// A piece of a message: plain text or styled text.
type Chunk =
	| string
	| {
			bold?: boolean;
			underline?: boolean;
			color?: string | null;
			string: string;
	  };

interface Problem {
	title: string;
	region: { start: { line: number; column: number } };
	message: Chunk[];
}

/** The report `make --report=json` writes to stderr when it fails. */
export type CompileReport =
	| {
			type: "compile-errors";
			errors: { path: string; problems: Problem[] }[];
	  }
	| { type: "error"; path: string | null; title: string; message: Chunk[] };

/// ANSI codes of the colors the compiler uses, by lowercase name.
const COLORS: Record<string, number> = {
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
};

/// Width of the header line of a problem, as the compiler prints it.
const WIDTH = 80;

/// Renders one chunk with ANSI escapes.
function chunk(part: Chunk): string {
	if (typeof part === "string") return part;
	const codes: number[] = [];
	if (part.bold) codes.push(1);
	if (part.underline) codes.push(4);
	const color = part.color ? COLORS[part.color.toLowerCase()] : undefined;
	if (color) codes.push(color);
	return codes.length
		? `\x1b[${codes.join(";")}m${part.string}\x1b[0m`
		: part.string;
}

/// `-- TITLE ------------- path`, padded to `WIDTH`.
function header(title: string, path: string): string {
	const dashes = Math.max(1, WIDTH - title.length - path.length - 5);
	return `\x1b[36m-- ${title} ${"-".repeat(dashes)} ${path}\x1b[0m`;
}

/**
 * Renders `report` as the compiler would print it, and lists a diagnostic
 * for every problem located in one of the student's files.
 *
 * @param fileOf maps a path in the report to the student's file, or null
 *   for a file the student did not write.
 */
export function renderReport(
	report: CompileReport,
	fileOf: (path: string) => string | null,
): { text: string; diagnostics: Diagnostic[] } {
	if (report.type === "error") {
		const path = report.path ? (fileOf(report.path) ?? report.path) : "";
		return {
			text: `${header(report.title, path)}\n\n${report.message.map(chunk).join("")}\n`,
			diagnostics: [],
		};
	}
	const blocks: string[] = [];
	const diagnostics: Diagnostic[] = [];
	for (const error of report.errors) {
		const file = fileOf(error.path);
		for (const problem of error.problems) {
			blocks.push(
				`${header(problem.title, file ?? error.path)}\n\n${problem.message.map(chunk).join("")}\n`,
			);
			if (file) {
				diagnostics.push({
					file,
					line: Math.max(1, problem.region.start.line),
					column: Math.max(0, problem.region.start.column - 1),
					message: problem.title.slice(0, 500),
				});
			}
		}
	}
	return { text: `${blocks.join("\n")}\n`, diagnostics };
}
