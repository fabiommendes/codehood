import {
	createMemo,
	createSignal,
	createUniqueId,
	For,
	type JSX,
	Show,
} from "solid-js";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import type { PublicMultipleChoice } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import { CheckIcon, XIcon } from "./icons";
import Markdown from "./Markdown";
import { feedbackVariant, scoreBadge, scoreLabel } from "./scoreDisplay";
import type { QuestionMode } from "./types";

export interface MultipleChoiceViewProps {
	question: PublicMultipleChoice;
	value?: string | null;
	onChange?: (choiceId: string) => void;
	mode?: QuestionMode;
	result?: QuestionResult<"multiple-choice">;
}

/**
 * Renders a `PublicMultipleChoice` question.
 *
 * It has three possible modes:
 * 	- an interactive form `answer`,
 *  - a frozen display of the same form `readonly`
 *  - a graded review that marks correctness when the answer key is known `review`.
 *
 * The component only ever sees the public half of the question — it has no
 * way to leak a correct choice in `answer` or `readonly` mode, because it was
 * never given one; `review` mode gets correctness from `result.correct`
 * instead, which the caller supplies from `Question#answerKey()`.
 */
export default function MultipleChoiceView(
	props: MultipleChoiceViewProps,
): JSX.Element {
	const mode = () => props.mode ?? "answer";
	const name = createUniqueId();
	const feedbackId = `${name}-feedback`;

	// Uncontrolled fallback: seeded from `value` once, then tracked locally so
	// the radio group works even when the caller passes no `onChange`.
	const [internalValue, setInternalValue] = createSignal(props.value ?? null);
	const selected = () =>
		props.value !== undefined ? props.value : internalValue();

	const correctIds = createMemo(() => new Set(props.result?.correct ?? []));

	// Withheld means the key is absent, not empty: a question where no choice is
	// worth anything has a real, empty key, and every choice on it is wrong.
	const hasKey = createMemo(() => props.result?.correct !== undefined);

	function select(choiceId: string): void {
		if (mode() !== "answer") return;
		setInternalValue(choiceId);
		props.onChange?.(choiceId);
	}

	function rowClass(choiceId: string): string {
		if (mode() !== "review" || !hasKey()) return "";
		if (correctIds().has(choiceId)) return "bg-success/10 border-success";
		if (selected() === choiceId) return "bg-error/10 border-error";
		return "";
	}

	return (
		<div class="flex flex-col gap-4">
			<Show when={mode() === "review" && props.result}>
				{(result) => (
					<div class="flex justify-end">
						<Badge {...scoreBadge(result().score)}>
							{scoreLabel(result().score)}
						</Badge>
					</div>
				)}
			</Show>

			<Show when={props.question.preamble}>
				<div class="text-base-content/70">
					<Markdown text={props.question.preamble} />
				</div>
			</Show>

			<div class="text-base font-medium">
				<Markdown text={props.question.stem} />
			</div>

			<fieldset class="flex flex-col gap-2">
				<For each={props.question.choices}>
					{(choice) => (
						<label
							class={`flex cursor-pointer items-center gap-3 rounded-box border border-base-300 p-3 ${rowClass(choice.id)}`}
						>
							<input
								type="radio"
								name={name}
								class="radio"
								disabled={mode() !== "answer"}
								checked={selected() === choice.id}
								onChange={() => select(choice.id)}
								aria-describedby={
									props.result?.feedback ? feedbackId : undefined
								}
							/>
							<span class="flex-1">
								<Markdown text={choice.text} inline />
							</span>
							<Show
								when={
									mode() === "review" && hasKey() && correctIds().has(choice.id)
								}
							>
								<CheckIcon />
							</Show>
							<Show
								when={
									mode() === "review" &&
									hasKey() &&
									!correctIds().has(choice.id) &&
									selected() === choice.id
								}
							>
								<XIcon />
							</Show>
						</label>
					)}
				</For>
			</fieldset>

			<Show when={props.question.epilogue}>
				<div class="text-base-content/70">
					<Markdown text={props.question.epilogue} />
				</div>
			</Show>

			<Show when={mode() === "review" && props.result?.feedback}>
				{(feedback) => (
					<div id={feedbackId}>
						<Alert variant={feedbackVariant(props.result?.score ?? 0)}>
							{feedback()}
						</Alert>
					</div>
				)}
			</Show>
		</div>
	);
}
