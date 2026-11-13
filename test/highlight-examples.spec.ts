import { expect, test } from "@playwright/test";
import type { PublicCodeQuestion } from "mdq";
import { highlightExamples } from "@/utils/highlight-examples";

const question = (
	publicTests: PublicCodeQuestion["publicTests"],
): PublicCodeQuestion =>
	({
		type: "code",
		language: "elm",
		stem: "x",
		publicTests,
	}) as PublicCodeQuestion;

test("highlights only the example tests, in order, one line span per line", async () => {
	const html = await highlightExamples(
		question([
			{ format: "elm", text: "a = 1\nb = 2", firstLine: 3, example: true },
			{ format: "elm", text: "hidden = 0", firstLine: 9, example: false },
			{ format: "elm", text: "c = 3", firstLine: 12, example: true },
		]),
	);
	expect(html).toHaveLength(2);
	expect(html[0]?.match(/class="line"/g)).toHaveLength(2);
	expect(html.join("")).not.toContain("hidden");
});

test("a question without public tests has no examples", async () => {
	expect(await highlightExamples(question(undefined))).toEqual([]);
});
