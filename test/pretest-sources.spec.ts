/**
 * `pretestSources` and `summarizeReport`: which test sources the browser runs
 * as pretests, and the status line of a run.
 */
import { expect, test } from "@playwright/test";
import { parseQuestion, resolveTests } from "mdq";
import { summarizeReport } from "@/components/exam/code-pretest";
import type { ReportCase } from "@/components/runner/run-tests";
import { pretestSources } from "@/utils/pretest-sources";

const DOCUMENT = `---
id: sum
type: code
language: elm
file: Main.elm
---
Sum a list.

[code]

## [tests]

[a](A.elm)

[b](B.elm)

[c](C.elm)
`;

const ALL_PUBLIC = `module A exposing (tests)

-- mdq: [0] {public} first
tests = 1

-- mdq: [0] {example} second
more = 2
`;
const MIXED = `module B exposing (tests)

-- mdq: [0] {public} shown
tests = 1

-- mdq: [1] hidden
more = 2
`;
const UNANNOTATED = "module C exposing (tests)\n\ntests = 1\n";

function question(texts: Record<string, string>) {
	const parsed = parseQuestion(DOCUMENT);
	if (parsed.type !== "code") throw new Error("not a code question");
	return resolveTests(parsed, texts);
}

test("sends the whole text of a source whose regions are all public", () => {
	const sources = pretestSources(
		question({ "A.elm": ALL_PUBLIC, "B.elm": MIXED, "C.elm": UNANNOTATED }),
	);
	expect(sources).toEqual([{ format: "elm", text: ALL_PUBLIC }]);
});

test("leaves out a source with a hidden region or with no annotation", () => {
	const sources = pretestSources(
		question({ "A.elm": MIXED, "B.elm": MIXED, "C.elm": UNANNOTATED }),
	);
	expect(sources).toEqual([]);
});

test("keeps the order of the sources", () => {
	const other = ALL_PUBLIC.replace("module A", "module C");
	const sources = pretestSources(
		question({ "A.elm": ALL_PUBLIC, "B.elm": MIXED, "C.elm": other }),
	);
	expect(sources.map((source) => source.text)).toEqual([ALL_PUBLIC, other]);
});

test("a question without tests has no pretests", () => {
	const parsed = parseQuestion(
		"---\nid: x\ntype: code\nlanguage: elm\nfile: Main.elm\n---\nStem.\n\n[code]\n",
	);
	if (parsed.type !== "code") throw new Error("not a code question");
	expect(pretestSources(parsed)).toEqual([]);
});

const EXAMPLES_DOCUMENT = `---
id: media
type: code
language: elm
file: Main.elm
---
Stem.

[code]

## [tests]

\`\`\`elm
BLOCK
\`\`\`
`;

function examplesQuestion(block: string) {
	const parsed = parseQuestion(EXAMPLES_DOCUMENT.replace("BLOCK", block));
	if (parsed.type !== "code") throw new Error("not a code question");
	return parsed;
}

test("an examples block yields its module with the public cases only", () => {
	const sources = pretestSources(
		examplesQuestion(
			[
				"-- mdq: [0] {example} Shown",
				"media [ 6, 8 ] ==> 7 -- inline",
				"",
				"-- mdq: [1] {public} Also shown",
				"media [] ==> 0",
				"",
				"-- mdq: [1] Hidden",
				"media [ 9 ] ==> 99999",
			].join("\n"),
		),
	);
	expect(sources).toHaveLength(1);
	const [source] = sources as [(typeof sources)[number]];
	expect(source.format).toBe("elm");
	expect(source.text).toContain("module Examples0 exposing (tests)");
	expect(source.text).toContain("import Main exposing (..)");
	expect(source.text).toContain("media [ 6, 8 ] ==> 7 (inline)");
	expect(source.text).toContain("media [] ==> 0");
	expect(source.text).not.toContain("99999");
	expect(source.text).not.toContain("mdq:");
});

test("an examples block with no public case is not a pretest", () => {
	expect(
		pretestSources(
			examplesQuestion("-- mdq: [1] Hidden\nmedia [ 9 ] ==> 99999"),
		),
	).toEqual([]);
});

test("an invalid examples block is not a pretest", () => {
	expect(
		pretestSources(examplesQuestion("-- mdq: [1] {public} Bad\nnonsense")),
	).toEqual([]);
});

const pass: ReportCase = { source: 0, verdict: "pass" };

test("a report with only passes passes", () => {
	expect(summarizeReport({ status: "completed", cases: [pass, pass] })).toEqual(
		{ kind: "passed", total: 2 },
	);
});

test("any verdict but pass counts as failed", () => {
	const cases: ReportCase[] = [
		pass,
		{ source: 0, verdict: "fail" },
		{ source: 0, verdict: "timeout" },
		{ source: 0, verdict: "skipped" },
	];
	expect(summarizeReport({ status: "completed", cases })).toEqual({
		kind: "failed",
		failed: 3,
		total: 4,
	});
});

test("a build error carries the compiler message", () => {
	expect(
		summarizeReport({ status: "build-error", cases: [], build: "boom" }),
	).toEqual({ kind: "build-error", build: "boom" });
});

test("a runner error, or a completed report with no case, is a runner error", () => {
	expect(
		summarizeReport({ status: "runner-error", cases: [], message: "x" }),
	).toEqual({ kind: "runner-error", message: "x" });
	expect(summarizeReport({ status: "completed", cases: [] })).toEqual({
		kind: "runner-error",
		message: "",
	});
});

test("an examples block is never sent raw when the question has no file", () => {
	const parsed = parseQuestion(
		EXAMPLES_DOCUMENT.replace(
			"BLOCK",
			"-- mdq: [0] {public} A\nmedia [] ==> 0",
		).replace("file: Main.elm\n", ""),
	);
	if (parsed.type !== "code") throw new Error("not a code question");
	expect(pretestSources(parsed)).toEqual([]);
});
