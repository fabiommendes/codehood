/**
 * The examples block of an Elm question: one `expr ==> value` case per line,
 * with `mdq:` annotations, turned into an elm-test module.
 */

import { type Annotations, scanAnnotations } from "mdq";

/// The `ANNOTATION_START` terminal of the MDQ spec, section "Annotations" of
/// `docs/question-types/code.md`: the lines it matches belong to an annotation.
const ANNOTATION_START = /^[ \t!-/:-@[-`{-~]*mdq:/u;

/// The operators of a case, with the matcher each one generates.
const OPERATORS = ["==>", "~="] as const;
type Operator = (typeof OPERATORS)[number];

/// A case with the Elm text needed to generate its test.
interface ParsedCase extends ElmExampleCase {
	readonly operator: Operator;
	readonly expr: string;
	readonly value: string;
}

/** Why an examples block is invalid. */
export type ElmExamplesErrorKind =
	| "invalid-line"
	| "invalid-annotation"
	| "late-import"
	| "duplicate-name"
	| "no-cases"
	| "empty-region";

/** An examples block that breaks the format: a mistake of the question author. */
export class ElmExamplesError extends Error {
	constructor(
		message: string,
		/// The line of the block, from 1; `null` when the error has no line.
		readonly line: number | null,
		readonly kind: ElmExamplesErrorKind,
	) {
		super(message);
		this.name = "ElmExamplesError";
	}
}

/** One case of an examples block. */
export interface ElmExampleCase {
	/// The test name the student sees: `expr ==> value (comment)`.
	readonly name: string;
	/// The line of the block, from 1.
	readonly line: number;
	/// Whether the case is in a `{public}` or `{example}` region.
	readonly public: boolean;
}

/**
 * The cases of an examples block, in source order.
 *
 * @throws {ElmExamplesError} The block is invalid.
 */
export function elmExampleCases(text: string): ElmExampleCase[] {
	return parseBlock(text).cases.map(({ name, line, public: isPublic }) => ({
		name,
		line,
		public: isPublic,
	}));
}

/**
 * The elm-test module `Examples<index>` of an examples block, or `null` when
 * `publicOnly` is set and the block has no public case.
 *
 * @throws {ElmExamplesError} The block is invalid.
 */
export function elmExamplesModule(
	text: string,
	options: { index: number; answerFile: string; publicOnly?: boolean },
): string | null {
	const { imports, cases } = parseBlock(text);
	const chosen = options.publicOnly ? cases.filter((c) => c.public) : cases;
	if (chosen.length === 0) return null;
	const entries = chosen.map(
		(c, i) =>
			`${i === 0 ? "[" : ","} Test.test ${elmString(c.name)} ${test(c)}`,
	);
	return [
		`module Examples${options.index} exposing (tests)`,
		"",
		"import Expect",
		"import Test",
		`import ${elmAnswerModule(options.answerFile)} exposing (..)`,
		...imports,
		"",
		"",
		"tests : Test.Test",
		"tests =",
		"    Test.concat",
		...entries.map((entry) => `        ${entry}`),
		"        ]",
		"",
	].join("\n");
}

/** The module name of an Elm answer file: `Foo/Bar.elm` is `Foo.Bar`. */
export function elmAnswerModule(file: string): string {
	return file.replace(/\.elm$/, "").replaceAll("/", ".");
}

/// The test function of a case: `(\_ -> <expectation>)`.
function test(c: ParsedCase): string {
	const matcher =
		c.operator === "==>"
			? "Expect.equal"
			: "Expect.within (Expect.AbsoluteOrRelative 1.0e-9 1.0e-6)";
	return `(\\_ -> ${matcher} (${c.value}) (${c.expr}))`;
}

/// `text` as an Elm string literal.
function elmString(text: string): string {
	return `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/// The imports and cases of a block.
function parseBlock(text: string): { imports: string[]; cases: ParsedCase[] } {
	const scan = scanAnnotations(text);
	const [problem] = scan.problems;
	if (problem) {
		throw new ElmExamplesError(
			`line ${problem.line}: ${problem.message}`,
			problem.line,
			"invalid-annotation",
		);
	}
	const imports: string[] = [];
	const cases: ParsedCase[] = [];
	const names = new Set<string>();
	for (const [index, line] of scan.lines.entries()) {
		const number = index + 1;
		if (ANNOTATION_START.test(line) || isInsideAnnotation(scan, number)) {
			continue;
		}
		if (/^[ \t]*$/.test(line) || /^[ \t]*--/.test(line)) continue;
		if (/^import[ \t]/.test(line)) {
			if (cases.length > 0) {
				throw new ElmExamplesError(
					`line ${number}: import after the first case`,
					number,
					"late-import",
				);
			}
			imports.push(line.replace(/[ \t]+$/, ""));
			continue;
		}
		const parsed = parseCase(line, number, isPublic(scan, number));
		if (names.has(parsed.name)) {
			throw new ElmExamplesError(
				`line ${number}: duplicate case "${parsed.name}"`,
				number,
				"duplicate-name",
			);
		}
		names.add(parsed.name);
		cases.push(parsed);
	}
	checkRegions(scan, cases);
	if (cases.length === 0) {
		throw new ElmExamplesError("the block has no case", null, "no-cases");
	}
	return { imports, cases };
}

/// Whether line `number` is a feedback or comment line of an item.
function isInsideAnnotation(scan: Annotations, number: number): boolean {
	return scan.items.some(
		(item) => number >= item.line && number < item.line + item.annotationLines,
	);
}

/// Whether the region that holds line `number` is `{public}` or `{example}`.
function isPublic(scan: Annotations, number: number): boolean {
	const item = scan.items.findLast((it) => it.line <= number);
	return item?.public ?? false;
}

/// Fails when an annotated region has no case.
function checkRegions(scan: Annotations, cases: readonly ParsedCase[]): void {
	for (const item of scan.items) {
		const first = item.line + item.annotationLines;
		if (!cases.some((c) => c.line >= first && c.line <= item.end)) {
			throw new ElmExamplesError(
				`line ${item.line}: the annotated region has no case`,
				item.line,
				"empty-region",
			);
		}
	}
}

/// The case in `line`, without its inline comment.
function parseCase(
	line: string,
	number: number,
	isPublic: boolean,
): ParsedCase {
	const invalid = () =>
		new ElmExamplesError(
			`line ${number}: expected "expr ==> value" or "expr ~= value"${
				line.includes('"""') ? " (triple-quoted strings are not supported)" : ""
			}`,
			number,
			"invalid-line",
		);
	const commentAt = outsideLiterals(line, "--");
	const code = commentAt.length > 0 ? line.slice(0, commentAt[0]) : line;
	const comment =
		commentAt.length > 0 ? trim(line.slice((commentAt[0] as number) + 2)) : "";
	const found = OPERATORS.flatMap((operator) =>
		outsideLiterals(code, operator).map((at) => ({ operator, at })),
	);
	if (found.length !== 1) throw invalid();
	const { operator, at } = found[0] as { operator: Operator; at: number };
	const expr = trim(code.slice(0, at));
	const value = trim(code.slice(at + operator.length));
	if (expr === "" || value === "") throw invalid();
	const name = `${expr} ${operator} ${value}${comment ? ` (${comment})` : ""}`;
	return { name, line: number, public: isPublic, operator, expr, value };
}

/// The positions of `token` in `text` that are not inside a string or char literal.
function outsideLiterals(text: string, token: string): number[] {
	const found: number[] = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i] as string;
		if (
			ch === '"' ||
			(ch === "'" && !/[\p{L}\p{N}_']/u.test(lastChar(text, i)))
		) {
			i = literalEnd(text, i);
		} else if (text.startsWith(token, i)) {
			found.push(i);
			i += token.length;
		} else {
			i += 1;
		}
	}
	return found;
}

/// The character before position `at`, as a whole code point, or "" at the start.
function lastChar(text: string, at: number): string {
	return Array.from(text.slice(Math.max(0, at - 2), at)).pop() ?? "";
}

/// The index after the literal that opens at `start`, or the text length when unterminated.
function literalEnd(text: string, start: number): number {
	const quote = text[start];
	let i = start + 1;
	while (i < text.length) {
		if (text[i] === "\\") i += 2;
		else if (text[i] === quote) return i + 1;
		else i += 1;
	}
	return text.length;
}

/// `text` without spaces and tabs at the ends.
function trim(text: string): string {
	return text.replace(/^[ \t]+|[ \t]+$/g, "");
}
