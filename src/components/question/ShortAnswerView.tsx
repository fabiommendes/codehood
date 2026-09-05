import {
	createMemo,
	createSignal,
	createUniqueId,
	type JSX,
	Show,
} from "solid-js";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import type { PublicShortAnswer } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import { validateShortAnswer } from "@/mdq/short-answer";
import { CheckIcon, XIcon } from "./icons";
import Markdown from "./Markdown";
import {
	PENDING_LABEL,
	pendingBadge,
	scoreBadge,
	scoreLabel,
} from "./scoreDisplay";
import type { QuestionMode } from "./types";

export interface ShortAnswerViewProps {
	question: PublicShortAnswer;
	value?: string;
	onChange?: (text: string) => void;
	mode?: QuestionMode;
	result?: QuestionResult<"short-answer">;
}

/**
 * Renders a `PublicShortAnswer` question as one line of text.
 *
 * Correctness in `review` mode comes from `result.score` rather than from the
 * key, as it does for numeric and more so: the key deliberately excludes the
 * question's regexes, so this component could not reproduce the verdict even
 * in principle. See `dev/specs/to-do/question-short-answer.md`, "The answer key
 * is the literals, not the rules".
 */
export default function ShortAnswerView(
	props: ShortAnswerViewProps,
): JSX.Element {
	const mode = () => props.mode ?? "answer";
	const name = createUniqueId();
	const feedbackId = `${name}-feedback`;
	const inputId = `${name}-answer`;
	const warningId = `${name}-warning`;

	// Uncontrolled fallback: seeded from `value` once, then tracked locally so
	// the box works even when the caller passes no `onChange`.
	const [internalValue, setInternalValue] = createSignal(props.value ?? "");
	const text = () =>
		props.value !== undefined ? props.value : internalValue();

	// `pending` and a zero score are different things: a response the question
	// could not settle is not a wrong one.
	const graded = () => mode() === "review" && props.result !== undefined;
	const settled = () => graded() && !props.result?.pending;
	const correct = () => (props.result?.score ?? 0) > 0;

	// mdq.spec's pre-validation: advice while the student types, never a gate.
	// It plays no part in grading and does not stop a submission.
	const warning = createMemo(() =>
		mode() === "answer" && text().trim() !== ""
			? validateShortAnswer(text(), props.question)
			: undefined,
	);

	function edit(next: string): void {
		setInternalValue(next);
		props.onChange?.(next);
	}

	return (
		<div class="flex flex-col gap-4">
			<Show when={graded()}>
				<div class="flex justify-end">
					<Show
						when={settled()}
						fallback={<Badge {...pendingBadge()}>{PENDING_LABEL}</Badge>}
					>
						<Badge {...scoreBadge(props.result?.score ?? 0)}>
							{scoreLabel(props.result?.score ?? 0)}
						</Badge>
					</Show>
				</div>
			</Show>

			<Show when={props.question.preamble}>
				<div class="text-base-content/70">
					<Markdown text={props.question.preamble} />
				</div>
			</Show>

			<div class="text-base font-medium">
				<Markdown text={props.question.stem} />
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex flex-wrap items-center gap-3">
					<input
						id={inputId}
						type="text"
						class="input w-full max-w-sm disabled:text-base-content"
						placeholder="Your answer"
						disabled={mode() !== "answer"}
						value={text()}
						onInput={(event) => edit(event.currentTarget.value)}
						aria-label="Your answer"
						aria-describedby={
							warning()
								? warningId
								: props.result?.feedback
									? feedbackId
									: undefined
						}
					/>
					<Show when={settled()}>
						<Show when={correct()} fallback={<XIcon />}>
							<CheckIcon />
						</Show>
					</Show>
				</div>

				<Show when={warning()}>
					{(flagged) => (
						<p id={warningId} class="text-sm text-warning">
							{flagged().feedback ??
								"That does not look like the kind of answer this question expects."}
						</p>
					)}
				</Show>

				<Show when={props.question.openEnded && mode() === "answer"}>
					<p class="text-xs text-base-content/60">
						This question is graded by hand.
					</p>
				</Show>
			</div>

			<Show when={props.question.epilogue}>
				<div class="text-base-content/70">
					<Markdown text={props.question.epilogue} />
				</div>
			</Show>

			<Show when={graded() && props.result?.correct?.length}>
				<div class="rounded-box border border-info/40 bg-info/5 p-4">
					<h4 class="mb-2 text-sm font-semibold text-info">
						{props.result?.correct?.length === 1
							? "Accepted answer"
							: "Accepted answers"}
					</h4>
					<ul class="flex flex-wrap gap-2">
						{props.result?.correct?.map((answer) => (
							<li class="badge badge-outline">{answer}</li>
						))}
					</ul>
				</div>
			</Show>

			<Show when={mode() === "review" && props.result?.feedback}>
				{(feedback) => (
					<div id={feedbackId}>
						{/*
						 * Not the shared `feedbackVariant`: short-answer grading is
						 * binary, so a score of 0 means wrong rather than neutral.
						 */}
						<Alert variant={correct() ? "success" : "error"}>
							{feedback()}
						</Alert>
					</div>
				)}
			</Show>
		</div>
	);
}
