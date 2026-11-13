import { expect, test } from "@playwright/test";
import { parseQuestion, resolveTests } from "mdq";
import { instructorReport } from "@/components/grading/code-report";

// The instructor's reading of a worker report: every case, the hidden marked.

const question = (() => {
	const parsed = parseQuestion(
		[
			"---",
			"id: sum",
			"type: code",
			"language: elm",
			"file: Main.elm",
			"---",
			"Sum it.",
			"",
			"[code]",
			"",
			"## [tests]",
			"",
			"[tests](T.elm)",
			"",
		].join("\n"),
	);
	if (parsed.type !== "code") throw new Error("not a code question");
	return resolveTests(parsed, {
		"T.elm": [
			"module T exposing (..)",
			"",
			"-- mdq: [+1] {example} Example",
			"a = 1",
			"",
			"-- mdq: [+2] Hidden",
			"b = 2",
			"",
		].join("\n"),
	});
})();

const report = (status: string, extra: object = {}) => ({
	status,
	runner: { name: "x" },
	cases: [],
	...extra,
});

test("a case in a hidden region is marked hidden", () => {
	const read = instructorReport(
		question,
		report("completed", {
			cases: [
				{ source: 0, line: 4, id: "a", verdict: "pass" },
				{ source: 0, line: 7, id: "b", verdict: "fail", message: "boom" },
			],
		}),
	);
	if (read.kind !== "report") throw new Error("expected a report");
	expect(read.cases.map((c) => [c.id, c.hidden])).toEqual([
		["a", false],
		["b", true],
	]);
	expect(read.cases[1]?.message).toBe("boom");
});

test("a build error carries the compiler message and no case", () => {
	const read = instructorReport(
		question,
		report("build-error", { build: "syntax error" }),
	);
	expect(read).toMatchObject({
		kind: "report",
		status: "build-error",
		build: "syntax error",
		cases: [],
	});
});

test("a report that does not fit the question is invalid", () => {
	const read = instructorReport(question, { nope: true });
	expect(read.kind).toBe("invalid");
});
