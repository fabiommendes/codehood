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
import type { PublicMultipleSelection } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import { CheckIcon, XIcon } from "./icons";
import Markdown from "./Markdown";
import { feedbackVariant, scoreBadge, scoreLabel } from "./scoreDisplay";
import type { QuestionMode } from "./types";

export interface MultipleSelectionViewProps {
	question: PublicMultipleSelection;
	value?: ReadonlySet<string>;
	onChange?: (choiceIds: Set<string>) => void;
	mode?: QuestionMode;
	result?: QuestionResult<"multiple-selection">;
}

/**
 * Renders a `PublicMultipleSelection` question.
 *
 * It has the same three modes as `MultipleChoiceView`, but every choice is a
 * checkbox rather than one radio group, and correctness in `review` mode is a
 * judgement — ticked matches `result.correct.has(id)` — rather than a read of
 * what was ticked. A correct choice left unticked therefore renders wrong,
 * and an incorrect choice correctly left alone renders right; see
 * `dev/specs/to-review/question-rendering.md`, "The view derives per-choice
 * correctness, and never gets it handed over".
 */
export default function MultipleSelectionView(
	props: MultipleSelectionViewProps,
): JSX.Element {
	const mode = () => props.mode ?? "answer";
	const name = createUniqueId();
	const feedbackId = `${name}-feedback`;

	// Uncontrolled fallback: seeded from `value` once, then tracked locally so
	// the checkboxes work even when the caller passes no `onChange`.
	const [internalValue, setInternalValue] = createSignal<ReadonlySet<string>>(
		props.value ?? new Set(),
	);
	const selected = () =>
		props.value !== undefined ? props.value : internalValue();

	const correctIds = createMemo(() => props.result?.correct);

	// Withheld means the key is absent, not empty: the schema allows a question
	// where no choice is correct, and on one of those every unticked choice was
	// judged correctly.
	const hasKey = createMemo(() => correctIds() !== undefined);

	function toggle(choiceId: string): void {
		if (mode() !== "answer") return;
		const next = new Set(selected());
		if (next.has(choiceId)) next.delete(choiceId);
		else next.add(choiceId);
		setInternalValue(next);
		props.onChange?.(next);
	}

	/** Whether the row's ticked state matches what it should have been. */
	function judgedCorrectly(choiceId: string): boolean {
		const ticked = selected().has(choiceId);
		const shouldBeTicked = correctIds()?.has(choiceId) ?? false;
		return ticked === shouldBeTicked;
	}

	function rowClass(choiceId: string): string {
		if (mode() !== "review" || !hasKey()) return "";
		return judgedCorrectly(choiceId)
			? "bg-success/10 border-success"
			: "bg-error/10 border-error";
	}

	function choiceFeedback(choiceId: string): string | undefined {
		return props.result?.choices?.find((c) => c.id === choiceId)?.feedback;
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
					{(choice) => {
						const inputId = `${name}-${choice.id}`;
						return (
							<div
								class={`flex flex-col gap-1 rounded-box border border-base-300 p-3 ${rowClass(choice.id)}`}
							>
								<label class="flex cursor-pointer items-center gap-3">
									<input
										id={inputId}
										type="checkbox"
										class="checkbox"
										disabled={mode() !== "answer"}
										checked={selected().has(choice.id)}
										onChange={() => toggle(choice.id)}
										aria-describedby={
											props.result?.feedback ? feedbackId : undefined
										}
									/>
									<span class="flex-1">
										<Markdown text={choice.text} inline />
									</span>
									<Show
										when={
											mode() === "review" &&
											hasKey() &&
											judgedCorrectly(choice.id)
										}
									>
										<CheckIcon />
									</Show>
									<Show
										when={
											mode() === "review" &&
											hasKey() &&
											!judgedCorrectly(choice.id)
										}
									>
										<XIcon />
									</Show>
								</label>
								<Show when={mode() === "review" && choiceFeedback(choice.id)}>
									{(feedback) => (
										<p class="pl-8 text-sm text-base-content/60">
											<Markdown text={feedback()} inline />
										</p>
									)}
								</Show>
							</div>
						);
					}}
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
