import { For, type JSX } from "solid-js";
import { m } from "@/i18n";
import type { CodeAttemptOutcome } from "@/services/exam-result";
import { SendRow } from "./CodeAnswer";
import type { CodeSends } from "./code-sends";

/**
 * The sends of a code question in the exam's review: the state, the cases and
 * the score of each, its discount, and which one counts for the question.
 *
 * Read-only. `attempts` comes from the exam result and holds the graded sends only.
 */
export default function CodeSendsReview(props: {
	sends: CodeSends;
	attempts: readonly CodeAttemptOutcome[] | undefined;
}): JSX.Element {
	const weightOf = (submission: string) =>
		props.attempts?.find((entry) => entry.submission === submission);
	return (
		<ol
			class="m-0 flex list-none flex-col gap-2 p-0"
			aria-label={m.code_review_sends()}
			data-sends
			data-mode="review"
		>
			<For each={props.sends.submissions}>
				{(sent, index) => (
					<SendRow
						sent={sent}
						n={index() + 1}
						weight={weightOf(sent.submission)}
					/>
				)}
			</For>
		</ol>
	);
}
