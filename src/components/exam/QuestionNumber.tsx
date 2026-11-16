import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { m } from "@/i18n";

export interface QuestionNumberProps {
	/// The question's position in the exam, from 1.
	number: number;
	/// Text color class of the label.
	tone?: string;
	class?: string;
	/// The question's points out of 100 (`formatPoints`), shown after the label when given.
	points?: string;
}

/// "Q3", the label students and instructors use to refer to a question, with its points when given.
export default function QuestionNumber(
	props: QuestionNumberProps,
): JSX.Element {
	return (
		<>
			<span
				class={`font-display font-semibold leading-none tracking-tight ${props.tone ?? ""} ${props.class ?? ""}`}
			>
				{m.exams_attempt_question_short({ number: props.number })}
			</span>
			<Show when={props.points}>
				{(points) => (
					<>
						{" "}
						<span class="whitespace-nowrap text-xs font-normal tabular-nums text-muted">
							{m.exams_attempt_points({ points: points() })}
						</span>
					</>
				)}
			</Show>
		</>
	);
}
