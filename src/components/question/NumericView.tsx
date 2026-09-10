import { createUniqueId, type JSX, Show } from "solid-js";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import { formatNumericInput as format } from "@/mdq/numeric";
import type { PublicNumeric } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import { CheckIcon, XIcon } from "./icons";
import Markdown from "./Markdown";
import NumericInput from "./NumericInput";
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

	const graded = () => mode() === "review" && props.result !== undefined;
	const correct = () => (props.result?.score ?? 0) > 0;

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
				<NumericInput
					id={inputId}
					class="w-48"
					domain={props.question.domain}
					unit={props.question.unit}
					decimalPlaces={props.question.decimalPlaces}
					value={props.value}
					onChange={(next) => props.onChange?.(next)}
					disabled={mode() !== "answer"}
					ariaLabel="Your answer"
					ariaDescribedBy={props.result?.feedback ? feedbackId : undefined}
				/>

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
