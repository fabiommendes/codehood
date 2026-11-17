import {
	brasiliaFillIn,
	capitalChoice,
	capitalShortAnswer,
	capitalShortAnswerManual,
	fibonacciOrdering,
	idempotenceEssay,
	multipleChoice,
	plateauFillIn,
	primesSelection,
	protocolsTrueFalse,
	sumCode,
	waterNumeric,
} from "@/mdq/fixtures";
import { responseSummary, summaryGroups } from "@/services/response-summary";
import { isAutoGraded } from "@/utils/question-display";
import { expect, test } from "./fixtures";

// The one-line summary of a response and the predicate that picks the questions shown as a list.

const text = (
	question: Parameters<typeof responseSummary>[0],
	payload: unknown,
) => responseSummary(question, payload).text;

test("multiple choice shows the letter in document order and the choice text", () => {
	expect(text(capitalChoice, "brasilia")).toBe("A. Brasília");
	expect(text(capitalChoice, "sao-paulo")).toBe("C. São Paulo");
});

test("multiple choice strips markdown and truncates long text, keeping the whole in the title", () => {
	const question = multipleChoice({
		id: "long",
		stem: "Pick.",
		choices: [
			{
				id: "a",
				text: [
					"**Bold** and `code` with a [link](http://x.y)",
					...Array(20).fill("word"),
				].join(" "),
				score: 1,
			},
			{ id: "b", text: "Other", score: 0 },
		],
	});
	const summary = responseSummary(question, "a");
	expect(summary.text.startsWith("A. Bold and code with a link word")).toBe(
		true,
	);
	expect(summary.text.length).toBeLessThanOrEqual(53);
	expect(summary.text.endsWith("…")).toBe(true);
	expect(summary.title).toContain("word word word word word word word");
});

test("multiple choice marks a blank and a removed choice", () => {
	expect(text(capitalChoice, null)).toBe("(blank)");
	expect(text(capitalChoice, "")).toBe("(blank)");
	expect(text(capitalChoice, "gone")).toBe("(removed)");
});

test("multiple selection lists the letters in document order", () => {
	expect(text(primesSelection, ["five", "two"])).toBe("A, D");
	expect(text(primesSelection, [])).toBe("(none selected)");
	expect(text(primesSelection, null)).toBe("(blank)");
});

test("true-false gives one mark per statement in document order, with a mark for an abstention", () => {
	expect(
		text(protocolsTrueFalse, { "tcp-order": true, "udp-guarantee": false }),
	).toBe("T F");
	expect(text(protocolsTrueFalse, { "udp-guarantee": true })).toBe("– T");
	expect(text(protocolsTrueFalse, { "tcp-order": null })).toBe("– –");
});

test("numeric shows the value with its unit", () => {
	expect(text(waterNumeric, 1000)).toBe("1000");
	expect(text(waterNumeric, "1/3")).toBe("1/3");
	expect(text(waterNumeric, { value: 998, unit: "g" })).toBe("998 g");
});

test("short answer shows the text, truncated with the whole text as title", () => {
	expect(text(capitalShortAnswer, "  Brasília ")).toBe("Brasília");
	const long = "x".repeat(80);
	const summary = responseSummary(capitalShortAnswer, long);
	expect(summary.text).toHaveLength(50);
	expect(summary.title).toBe(long);
	expect(text(capitalShortAnswer, "  ")).toBe("(blank)");
});

test("fill-in joins the blanks in order, with the choice text and a dash for an empty one", () => {
	expect(
		text(brasiliaFillIn, {
			river: "Central",
			capital: "brasilia",
			size: 2800000,
		}),
	).toBe("Brasília · 2800000 · Central");
	expect(
		text(brasiliaFillIn, {
			capital: "rio",
			size: { value: 3, unit: "people" },
		}),
	).toBe("Rio de Janeiro · 3 people · –");
	expect(text(plateauFillIn, { capital: "gone", plateau: "" })).toBe(
		"(removed) · –",
	);
});

test("ordering gives the position of each submitted line in the answer key", () => {
	const [a, b, c, d] = fibonacciOrdering.lines;
	expect(text(fibonacciOrdering, [a, b, d, c])).toBe("1 2 4 3");
	expect(text(fibonacciOrdering, [a, [1, "x = y"], c])).toBe("1 ? 3");
});

test("an unanswered question is blank whatever its type", () => {
	for (const question of [
		waterNumeric,
		brasiliaFillIn,
		fibonacciOrdering,
		protocolsTrueFalse,
	]) {
		expect(text(question, null)).toBe("(blank)");
	}
});

test("summaryGroups counts identical responses, the largest group first", () => {
	const groups = summaryGroups(waterNumeric, [25, 120, 120, null, 120, 25]);
	expect(groups.map((group) => [group.text, group.count])).toEqual([
		["120", 3],
		["25", 2],
		["(blank)", 1],
	]);
});

test("only a question the library grades by itself, other than code, is shown as a list", () => {
	expect(isAutoGraded(capitalChoice)).toBe(true);
	expect(isAutoGraded(primesSelection)).toBe(true);
	expect(isAutoGraded(protocolsTrueFalse)).toBe(true);
	expect(isAutoGraded(waterNumeric)).toBe(true);
	expect(isAutoGraded(capitalShortAnswer)).toBe(true);
	expect(isAutoGraded(brasiliaFillIn)).toBe(true);
	expect(isAutoGraded(fibonacciOrdering)).toBe(true);
	expect(isAutoGraded(capitalShortAnswerManual)).toBe(false);
	expect(isAutoGraded(plateauFillIn)).toBe(false);
	expect(isAutoGraded(idempotenceEssay)).toBe(false);
	expect(isAutoGraded(sumCode)).toBe(false);
});
