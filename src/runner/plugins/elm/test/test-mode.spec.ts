import { readFileSync } from "node:fs";
import { collect, loadFrame, start } from "@codehood/runner/testing/suite";
import { expect, test } from "@playwright/test";
import { parseReport } from "mdq";
import {
	elmCases,
	elmModule,
	parseSuite,
	stripAnsi,
} from "../../../../components/runner/test-report";

/**
 * The Elm driver in `test` mode: the JSON of the suite, turned into an MDQ
 * runner report the way `runTests` does. Run with
 * `pnpm run test:plugins --project=elm`.
 */

const fixture = (name: string) =>
	readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const PRE = fixture("Pre.elm");
const HIDDEN = fixture("Hidden.elm");

const CORRECT = `module Main exposing (soma)


soma : List Int -> Int
soma xs =
    List.sum xs
`;

/// Wrong for any list but the empty one.
const WRONG = CORRECT.replace("List.sum xs", "0");

const BROKEN = CORRECT.replace("List.sum xs", 'List.sum "xs"');

type Harness = Awaited<ReturnType<typeof loadFrame>>;

/// Runs the test sources against `answer`, one run each, as `runTests` does.
async function report(h: Harness, answer: string, tests: string[]) {
	const cases = [];
	for (const [source, text] of tests.entries()) {
		const entry = `${elmModule(text)}.elm`;
		const id = await start(h, "", "elm", {
			mode: "test",
			extra: { files: { "Main.elm": answer, [entry]: text }, entry },
		});
		const result = await collect(h, id, 80_000);
		if (result.exit.code === 1) {
			return {
				status: "build-error",
				cases: [],
				build: stripAnsi(result.stderr).trim(),
			};
		}
		expect(result.exit).toMatchObject({ reason: "exited", code: 0 });
		const suite = parseSuite(result.stdout);
		if (!suite || "invalid" in suite) throw new Error(result.stdout);
		cases.push(...elmCases(source, text, suite.cases));
	}
	return { status: "completed", cases };
}

test.describe("elm test mode", () => {
	test.setTimeout(180_000);

	test("a correct answer passes every case, at the line of its definition", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await report(h, CORRECT, [PRE]);
		expect(result).toEqual({
			status: "completed",
			cases: [
				{ source: 0, line: 12, verdict: "pass", id: "pre > vazia" },
				{ source: 0, line: 13, verdict: "pass", id: "pre > um" },
			],
		});
		expect(() => parseReport(result)).not.toThrow();
	});

	test("a wrong answer fails with message, expected and actual", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const result = await report(h, WRONG, [PRE]);
		expect(result.status).toBe("completed");
		const [vazia, um] = result.cases as [
			(typeof result.cases)[number],
			(typeof result.cases)[number],
		];
		expect(vazia).toMatchObject({ line: 12, verdict: "pass" });
		expect(um).toMatchObject({
			line: 13,
			verdict: "fail",
			id: "pre > um",
			expected: "7",
			actual: "0",
		});
		// Numbers are never diffed, so the message has no highlight.
		expect(um.message).toBeTruthy();
		expect(um.message).not.toContain("\x1b");
		expect(() => parseReport(result)).not.toThrow();
	});

	test("the message marks in red where expected and actual differ", async ({
		page,
	}) => {
		const h = await loadFrame(page);
		const lists = `module Lists exposing (tests)

import Expect
import Main exposing (soma)
import Test exposing (Test, test)


tests : Test
tests =
    test "lista" <| \\_ -> Expect.equal [ 1, 7, 3 ] [ 1, soma [ 7 ], 3 ]
`;
		const result = await report(h, WRONG, [lists]);
		const [lista] = result.cases as { verdict: string; message?: string }[];
		expect(lista?.verdict).toBe("fail");
		expect(lista?.message).toContain("\x1b[31m");
	});

	test("an answer that does not compile is a build error", async ({ page }) => {
		const h = await loadFrame(page);
		const result = await report(h, BROKEN, [PRE]);
		expect(result.status).toBe("build-error");
		expect(result.cases).toEqual([]);
		expect(result.build).toContain("TYPE MISMATCH");
		expect(result.build).toContain("Main.elm");
		expect(() => parseReport(result)).not.toThrow();
	});

	test("two test sources give cases with source 0 and 1", async ({ page }) => {
		const h = await loadFrame(page);
		const result = await report(h, CORRECT, [PRE, HIDDEN]);
		expect(result.cases.map((c) => [c.source, c.line, c.verdict])).toEqual([
			[0, 12, "pass"],
			[0, 13, "pass"],
			[1, 12, "pass"],
			[1, 14, "pass"],
		]);
		expect(() => parseReport(result)).not.toThrow();
	});
});
