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
import type { PublicTrueFalse } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import { CheckIcon, XIcon } from "./icons";
import Markdown from "./Markdown";
import { feedbackVariant, scoreBadge, scoreLabel } from "./scoreDisplay";
import type { QuestionMode } from "./types";

export interface TrueFalseViewProps {
	question: PublicTrueFalse;
	value?: ReadonlyMap<string, boolean>;
	onChange?: (answers: Map<string, boolean>) => void;
	mode?: QuestionMode;
	result?: QuestionResult<"true-false">;
}

/**
 * Renders a `PublicTrueFalse` question.
 *
 * Each statement gets one three-state toggle — unchecked is False, checked is
 * True, and a centered knob is unmarked — rather than a
 * pair of controls, because a statement can be abstained as well as judged;
 * see `dev/specs/to-do/question-true-false.md`, "Abstaining is a third
 * state". Cycling back to unmarked deletes the statement's entry from the
 * answer map rather than writing a sentinel, since absence is how abstention
 * is represented all the way down to the grader.
 */
export default function TrueFalseView(props: TrueFalseViewProps): JSX.Element {
	const mode = () => props.mode ?? "answer";
	const name = createUniqueId();
	const feedbackId = `${name}-feedback`;

	// Uncontrolled fallback: seeded from `value` once, then tracked locally so
	// the toggles work even when the caller passes no `onChange`.
	const [internalValue, setInternalValue] = createSignal<
		ReadonlyMap<string, boolean>
	>(props.value ?? new Map());
	const judgements = () =>
		props.value !== undefined ? props.value : internalValue();

	const correct = createMemo(() => props.result?.correct);

	// Withheld means the key is absent, not empty: an exam still open for
	// review has no `correct` map at all, not one with nothing in it.
	const hasKey = createMemo(() => correct() !== undefined);

	function judge(statementId: string, mark: boolean | undefined): void {
		if (mode() !== "answer") return;
		const next = new Map(judgements());
		if (mark === undefined) next.delete(statementId);
		else next.set(statementId, mark);
		setInternalValue(next);
		props.onChange?.(next);
	}

	/**
	 * The three outcomes a statement can land on in review, or `undefined`
	 * while the key is withheld — a fourth "no verdict" bucket, not a fallback
	 * into one of the other three.
	 */
	function outcome(
		statementId: string,
	): "correct" | "wrong" | "abstained" | undefined {
		if (!hasKey()) return undefined;
		const judged = judgements().get(statementId);
		if (judged === undefined) return "abstained";
		return judged === correct()?.get(statementId) ? "correct" : "wrong";
	}

	function rowClass(statementId: string): string {
		switch (outcome(statementId)) {
			case "correct":
				return "bg-success/10 border-success";
			case "wrong":
				return "bg-error/10 border-error";
			default:
				return "";
		}
	}

	// daisyUI's `.toggle` only colors the *checked* state (`.toggle-success:checked`
	// etc. — there is no unchecked equivalent), so True gets its color from the
	// `toggle-success` modifier, but False has to force it via `text-error`
	// instead: the toggle's border and knob are painted with `currentColor`,
	// and a plain Tailwind utility in the `utilities` layer beats daisyUI's
	// `daisyui` layer, so it repaints an unchecked toggle regardless of the
	// checked-only modifier's own rules.
	//
	// `.toggle:disabled` also dims to 30% opacity, which would erase the very
	// thing review mode exists to show: what the student marked. Outside
	// `answer` mode every position keeps full opacity explicitly. The class
	// strings are written out rather than built from a tone, so Tailwind's
	// scanner can see them.
	const toggleColor = {
		false: { answer: "text-error", frozen: "text-error !opacity-100" },
		true: { answer: "toggle-success", frozen: "toggle-success !opacity-100" },
	} as const;

	// daisyUI centers the knob with `.toggle:indeterminate { grid-template-columns:
	// .5fr 1fr .5fr }`. `indeterminate` is a DOM property that cannot exist in
	// server-rendered markup, so the same declaration is applied as a class
	// instead: the unmarked state then survives with no JavaScript at all, which
	// is what lets a readonly or review card render without hydrating.
	const CENTERED = "[grid-template-columns:.5fr_1fr_.5fr]";

	function ariaChecked(
		judged: boolean | undefined,
	): "true" | "false" | "mixed" {
		if (judged === undefined) return "mixed";
		return judged ? "true" : "false";
	}

	function toggleClass(judged: boolean | undefined): string {
		if (judged === undefined)
			return mode() === "answer" ? CENTERED : `${CENTERED} !opacity-100`;
		return toggleColor[judged ? "true" : "false"][
			mode() === "answer" ? "answer" : "frozen"
		];
	}

	function choiceFeedback(statementId: string): string | undefined {
		return props.result?.choices?.find((c) => c.id === statementId)?.feedback;
	}

	function trueFalseLabel(props: {
		answer: boolean;
		marked: boolean | undefined;
	}): JSX.Element {
		const { answer, marked } = props;
		const label = answer ? "True" : "False";
		const opacity = marked === undefined ? 40 : marked === answer ? 80 : 40;
		const weight = marked === answer ? "font-bold" : "font-bold";
		return (
			<span class={`text-xs text-base-content/${opacity} ${weight}`}>
				{label}
			</span>
		);
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
						const judged = () => judgements().get(choice.id);

						// One click advances the knob in the direction it travels:
						// centered, right, left, back to centered. A `<button>` has no
						// activation behavior of its own to undo, so nothing here has to
						// fight the browser over what the control's state is.
						function cycle(): void {
							const current = judged();
							if (current === undefined) judge(choice.id, true);
							else if (current === true) judge(choice.id, false);
							else judge(choice.id, undefined);
						}

						return (
							<div
								class={`flex flex-col gap-2 rounded-box border border-base-300 p-3 ${mode() === "review" ? rowClass(choice.id) : ""}`}
							>
								<div class="flex items-center gap-3">
									<span class="flex-1">
										<Markdown text={choice.text} inline />
									</span>
									{trueFalseLabel({ answer: false, marked: judged() })}

									{/*
									 * A tri-state control is the ARIA checkbox pattern, not a
									 * native `<input type="checkbox">`: a checkbox has two
									 * states, and `indeterminate` is reachable only from
									 * script, never from the keyboard. `role="checkbox"` with
									 * `aria-checked="mixed"` announces all three, and a
									 * `<button>` already answers space and enter.
									 */}
									{/* biome-ignore lint/a11y/useSemanticElements: the rule suggests <input type="checkbox">, which is precisely what cannot work here — it has two states, and `indeterminate` is reachable from script but never from the keyboard */}
									<button
										type="button"
										role="checkbox"
										aria-checked={ariaChecked(judged())}
										class={`toggle ${toggleClass(judged())}`}
										aria-label={`True or false: ${choice.text}`}
										disabled={mode() !== "answer"}
										onClick={cycle}
										aria-describedby={
											props.result?.feedback ? feedbackId : undefined
										}
									/>
									{trueFalseLabel({ answer: true, marked: judged() })}
									<Show
										when={
											mode() === "review" && outcome(choice.id) === "correct"
										}
									>
										<CheckIcon />
									</Show>
									<Show
										when={mode() === "review" && outcome(choice.id) === "wrong"}
									>
										<XIcon />
									</Show>
								</div>
								<Show when={mode() === "review" && choiceFeedback(choice.id)}>
									{(feedback) => (
										<p class="text-sm text-base-content/60">
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
