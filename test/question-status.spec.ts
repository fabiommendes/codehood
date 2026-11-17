import path from "node:path";
import vm from "node:vm";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import {
	type QuestionStatus,
	type QuestionVisibility,
	visibility,
	webNext,
	writable,
} from "@/services/question-status";

const STATUSES = ["DRAFT", "PUBLISHED", "HIDDEN", "ARCHIVED"] as const;

test("webNext moves a published question to hidden, never back to draft", () => {
	expect(webNext).toEqual({
		DRAFT: "PUBLISHED",
		PUBLISHED: "HIDDEN",
		HIDDEN: "PUBLISHED",
		ARCHIVED: "DRAFT",
	});
});

test("webNext never offers archiving", () => {
	for (const status of STATUSES) expect(webNext[status]).not.toBe("ARCHIVED");
});

test("only an archived question refuses writes", () => {
	expect(STATUSES.filter((status) => !writable(status))).toEqual(["ARCHIVED"]);
});

type Row = [
	status: QuestionStatus,
	relation: "author" | "member" | "outsider",
	released: boolean,
	expected: QuestionVisibility,
];

const TABLE: Row[] = [
	// The author sees everything, released or not.
	...STATUSES.flatMap((s): Row[] => [
		[s, "author", false, "full"],
		[s, "author", true, "full"],
	]),
	// A member sees nothing of a question no open or closed exam holds...
	["PUBLISHED", "member", false, "absent"],
	["DRAFT", "member", false, "absent"],
	["HIDDEN", "member", false, "absent"],
	["ARCHIVED", "member", false, "absent"],
	// ...and the public half once such an exam releases it, never of a draft.
	["PUBLISHED", "member", true, "public"],
	["HIDDEN", "member", true, "public"],
	["ARCHIVED", "member", true, "public"],
	["DRAFT", "member", true, "absent"],
	// An outsider is refused whatever the status, so slugs stay indistinguishable.
	...STATUSES.flatMap((s): Row[] => [
		[s, "outsider", false, "refused"],
		[s, "outsider", true, "refused"],
	]),
];

for (const [status, relation, released, expected] of TABLE) {
	test(`visibility: ${status} ${relation}${released ? " released" : ""} is ${expected}`, () => {
		expect(
			visibility(status, {
				author: relation === "author",
				member: relation !== "outsider",
				released,
			}),
		).toBe(expected);
	});
}

test("the question status module loads in a browser", async () => {
	const result = await build({
		stdin: {
			contents: 'export * from "@/services/question-status";',
			resolveDir: path.resolve("src"),
		},
		alias: { "@": path.resolve("src") },
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		globalName: "mod",
		logLevel: "silent",
	});
	const context = vm.createContext({});
	vm.runInContext(result.outputFiles[0]?.text ?? "", context);
	expect(vm.runInContext("mod.webNext.DRAFT", context)).toBe("PUBLISHED");
});
