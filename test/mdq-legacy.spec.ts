import { expect, test } from "@playwright/test";
import { publicForm } from "@/mdq";
import { upgradeLegacyQuestion } from "@/mdq/legacy";
import { LEGACY } from "./legacy-questions";

test("a multiple choice gets its scores back and its preamble opens the stem", () => {
	const { publicPayload, privatePayload } = LEGACY.multipleChoice;
	const document = upgradeLegacyQuestion(publicPayload, privatePayload);

	expect(document).toMatchObject({
		type: "multiple-choice",
		stem: "Considere a aritmética usual.\n\nQuanto é 2 + 2?",
		choices: [
			{ id: "three", text: "3" },
			{ id: "four", text: "4", score: 1, feedback: "Isso." },
		],
	});
	expect(document).not.toHaveProperty("preamble");
});

test("an essay's input becomes content and keeps its answer key", () => {
	const { publicPayload, privatePayload } = LEGACY.essay;
	const document = upgradeLegacyQuestion(publicPayload, privatePayload);

	expect(document).toMatchObject({
		type: "essay",
		content: "text",
		answerKey: "Compila e minifica.",
	});
	expect(document).not.toHaveProperty("input");
});

test("a fill-in short answer blank's oneOf becomes accept", () => {
	const { publicPayload, privatePayload } = LEGACY.fillIn;
	const document = upgradeLegacyQuestion(publicPayload, privatePayload);

	expect(document).toMatchObject({
		blanks: [
			{ id: "cabeca", type: "short-answer", accept: ["tucano"] },
			{ id: "n", type: "numeric", answer: 2 },
		],
	});
});

test("the public form of an upgraded document leaves the answers out", () => {
	const { publicPayload, privatePayload } = LEGACY.multipleChoice;
	const document = upgradeLegacyQuestion(publicPayload, privatePayload);
	if (!document) throw new Error("expected an upgrade");

	expect(JSON.stringify(publicForm(document))).not.toContain("Isso.");
});

test("a current document is left alone", () => {
	const { publicPayload, privatePayload } = LEGACY.essay;
	const current = upgradeLegacyQuestion(publicPayload, privatePayload);

	expect(upgradeLegacyQuestion({}, current as never)).toBeNull();
});

test("halves that both define a field are refused", () => {
	expect(() =>
		upgradeLegacyQuestion(
			{ type: "essay", stem: "a" },
			{ stem: "b", answerKey: "c" },
		),
	).toThrow(/stem/);
});
