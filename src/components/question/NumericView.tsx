import {
	createEffect,
	createSignal,
	createUniqueId,
	type JSX,
	Show,
} from "solid-js";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import {
	formatNumericInput as format,
	parseNumericInput as parse,
} from "@/mdq/numeric";
import type { PublicNumeric } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import { CheckIcon, XIcon } from "./icons";
import Markdown from "./Markdown";
import { scoreBadge, scoreLabel } from "./scoreDisplay";
import type { QuestionMode } from "./types";

export interface NumericViewProps {
	question: PublicNumeric;
	value?: number | null;
	onChange?: (value: number | null) => void;
	mode?: QuestionMode;
	result?: QuestionResult<"numeric">;
}

/**
 * Renders a `PublicNumeric` question as one input box.
 *
 * Correctness in `review` mode is read off `result.score` rather than derived
 * from the key, which is the opposite of what the choice views do. It has to
 * be: correctness here is the tolerance test, and the tolerance is not part of
 * the public half, so comparing the student's number to the key would mark a
 * response inside a declared tolerance wrong. See
 * `dev/specs/to-do/question-numeric.md`, "Review reads the score, because it
 * cannot derive correctness".
 */
export default function NumericView(props: NumericViewProps): JSX.Element {
	const mode = () => props.mode ?? "answer";
	const name = createUniqueId();
	const feedbackId = `${name}-feedback`;
	const inputId = `${name}-value`;

	// The raw text, not the parsed number: a half-typed "3." or "-" is not a
	// number yet, and reformatting the box from the parsed value while someone
	// is still typing takes the caret with it.
	const [text, setText] = createSignal(format(props.value ?? null));

	// Follows the controlled value, and only that: an absent `value` means the
	// caller passed none, so the box owns its own text and must not be rewritten
	// from a `null` that was never an answer. Even when controlled the rewrite
	// waits until the two disagree as *numbers*, so a half-typed "3.50" is not
	// snapped back to "3.5" with the caret in it.
	createEffect(() => {
		const incoming = props.value;
		if (incoming === undefined) return;
		if (parse(text()) !== incoming) setText(format(incoming));
	});

	const graded = () => mode() === "review" && props.result !== undefined;
	const correct = () => (props.result?.score ?? 0) > 0;

	function edit(next: string): void {
		setText(next);
		props.onChange?.(parse(next));
	}

	// A number input rejects "1/3" outright, so a question that asks for a
	// fraction has to accept text or the domain means nothing.
	const isFraction = () => props.question.domain === "fraction";

	// `1` for whole numbers, `10⁻ᵈ` when the author fixed the decimals, and
	// otherwise no constraint at all.
	const step = (): string => {
		if (props.question.domain === "integer") return "1";
		const places = props.question.decimalPlaces;
		return places === undefined ? "any" : String(10 ** -places);
	};

	return (
		<div class="flex flex-col gap-4">
			<Show when={graded() && props.result}>
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

			<div class="flex flex-wrap items-center gap-3">
				<label
					class="input w-48 disabled:text-base-content"
					for={inputId}
					aria-label="Your answer"
				>
					<input
						id={inputId}
						type={isFraction() ? "text" : "number"}
						step={isFraction() ? undefined : step()}
						inputmode={isFraction() ? "text" : "decimal"}
						class="grow disabled:text-base-content"
						placeholder={isFraction() ? "a/b" : "Your answer"}
						disabled={mode() !== "answer"}
						value={text()}
						onInput={(event) => edit(event.currentTarget.value)}
						aria-describedby={props.result?.feedback ? feedbackId : undefined}
					/>
					<Show when={props.question.unit}>
						{(unit) => <span class="label">{unit()}</span>}
					</Show>
				</label>

				<Show when={graded()}>
					<Show when={correct()} fallback={<XIcon />}>
						<CheckIcon />
					</Show>
				</Show>

				{/*
				 * The expected value is the one thing the key controls. The check
				 * and the x above are not: the score badge next to them already
				 * says whether the response was accepted.
				 */}
				<Show when={graded() && props.result?.correct !== undefined}>
					<span class="text-sm text-base-content/60">
						Expected {format(props.result?.correct ?? null)}
						{props.question.unit ? ` ${props.question.unit}` : ""}
					</span>
				</Show>
			</div>

			<Show when={props.question.epilogue}>
				<div class="text-base-content/70">
					<Markdown text={props.question.epilogue} />
				</div>
			</Show>

			<Show when={mode() === "review" && props.result?.feedback}>
				{(feedback) => (
					<div id={feedbackId}>
						{/*
						 * Not the shared `feedbackVariant`, which calls a score of 0
						 * neutral: on the choice types 0 really is "no credit and no
						 * penalty", but numeric grading is binary, so 0 means wrong and
						 * an informational blue would say otherwise.
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
