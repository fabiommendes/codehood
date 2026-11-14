import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	ElmExamplesError,
	type ElmExamplesErrorKind,
	elmAnswerModule,
	elmExampleCases,
	elmExamplesModule,
} from "@/services/elm-examples";

/// One row of the case table shared with the chalk-worker.
interface Entry {
	name: string;
	input: string;
	answerFile: string;
	index: number;
	error?: { line: number | null; kind: ElmExamplesErrorKind };
	cases?: { name: string; line: number; public: boolean }[];
	module?: string;
	publicModule?: string | null;
}

const TABLE = "workers/chalk-worker/tests/resources/elm-examples-cases.json";
const entries: Entry[] = JSON.parse(readFileSync(TABLE, "utf8")).entries;

/// The error that `run` throws, or a failure when it throws none.
function thrown(run: () => unknown): unknown {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("expected an ElmExamplesError, nothing was thrown");
}

function expectExamplesError(run: () => unknown, entry: Entry): void {
	const error = thrown(run);
	expect(error).toBeInstanceOf(ElmExamplesError);
	const { line, kind } = error as ElmExamplesError;
	expect({ line, kind }).toEqual(entry.error);
}

test("the case table has valid and invalid entries", () => {
	expect(entries.filter((e) => e.error).length).toBeGreaterThan(0);
	expect(entries.filter((e) => !e.error).length).toBeGreaterThan(0);
});

for (const entry of entries) {
	const options = { index: entry.index, answerFile: entry.answerFile };

	if (entry.error) {
		test.describe(`invalid block: ${entry.name}`, () => {
			test("elmExampleCases throws", () => {
				expectExamplesError(() => elmExampleCases(entry.input), entry);
			});

			test("elmExamplesModule throws, with and without publicOnly", () => {
				expectExamplesError(
					() => elmExamplesModule(entry.input, options),
					entry,
				);
				expectExamplesError(
					() =>
						elmExamplesModule(entry.input, { ...options, publicOnly: true }),
					entry,
				);
			});
		});
		continue;
	}

	test.describe(`valid block: ${entry.name}`, () => {
		test("elmExampleCases gives names, lines and visibility", () => {
			const cases = elmExampleCases(entry.input).map((c) => ({
				name: c.name,
				line: c.line,
				public: c.public,
			}));
			expect(cases).toEqual(entry.cases);
		});

		test("elmExamplesModule gives the module with every case", () => {
			expect(elmExamplesModule(entry.input, options)).toBe(entry.module);
		});

		test("elmExamplesModule with publicOnly gives only the public cases", () => {
			expect(
				elmExamplesModule(entry.input, { ...options, publicOnly: true }),
			).toBe(entry.publicModule);
		});
	});
}

test("elmAnswerModule drops .elm and turns folders into dots", () => {
	expect(elmAnswerModule("Main.elm")).toBe("Main");
	expect(elmAnswerModule("Foo/Bar.elm")).toBe("Foo.Bar");
	expect(elmAnswerModule("A/B/C.elm")).toBe("A.B.C");
});

test("an unsupported triple-quoted string says so in the error message", () => {
	const error = thrown(() => elmExampleCases('"""a"b""" ==> 1\n'));
	expect((error as ElmExamplesError).message).toMatch(/triple-quoted/);
});
