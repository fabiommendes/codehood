import type { PublicCodeQuestion } from "mdq";
import { highlightCode } from "./highlight-code";

/**
 * The highlighted HTML of each `{example}` test of a code question, in the order `publicTests` lists them.
 *
 * It runs on the server with the site's code themes, the ones of the code editor beside the examples.
 */
export function highlightExamples(
	question: PublicCodeQuestion,
): Promise<string[]> {
	return Promise.all(
		(question.publicTests ?? [])
			.filter((test) => test.example)
			.map((test) => highlightCode(test.text, question.language)),
	);
}
