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
	expected: QuestionVisibility,
];

const TABLE: Row[] = [
	// The author sees everything.
	...STATUSES.map((s): Row => [s, "author", "full"]),
	// A member who is not the author sees nothing: an exam question reaches a student through its grant.
	...STATUSES.map((s): Row => [s, "member", "absent"]),
	// An outsider is refused whatever the status, so slugs stay indistinguishable.
	...STATUSES.map((s): Row => [s, "outsider", "refused"]),
];

for (const [status, relation, expected] of TABLE) {
	test(`visibility: ${status} ${relation} is ${expected}`, () => {
		expect(
			visibility(status, {
				author: relation === "author",
				member: relation !== "outsider",
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
