import { createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import Badge from "@/components/ui/Badge";
import { parseFillInStem } from "@/mdq/fill-in";
import type { PublicFillIn, PublicFillInBlank } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import ChoiceSelect from "./ChoiceSelect";
import { CheckIcon, XIcon } from "./icons";
import Markdown from "./Markdown";
import NumericInput from "./NumericInput";
import { scoreBadge, scoreLabel } from "./scoreDisplay";
import TextInput from "./TextInput";
import type { QuestionMode } from "./types";

export interface FillInViewProps {
	question: PublicFillIn;
	/** What the student put in each blank, keyed by blank id. */
	value?: Record<string, string>;
	onChange?: (next: Record<string, string>) => void;
	mode?: QuestionMode;
	result?: QuestionResult<"fill-in">;
}

/**
 * Renders a `PublicFillIn` question as a sentence with its blanks in place.
 *
 * The stem is split on its `[^id]` references and each fragment rendered
 * inline, so the controls flow with the text instead of stacking under it. A
 * reference the question declares no blank for has no control to draw and is
 * left in the sentence as written, which is what an author's typo should look
 * like — vanishing silently gives them nothing to go on.
 *
 * Per-blank verdicts come from `result.blanks` rather than from the key: a
 * numeric blank's tolerance and a short answer's regexes are not in the public
 * half, so this component could not reproduce them even in principle. Blanks
 * left empty are absent from that map and draw no mark at all.
 */
export default function FillInView(props: FillInViewProps): JSX.Element {
	const mode = () => props.mode ?? "answer";

	// Uncontrolled fallback, one signal for the whole question rather than one
	// per blank, which is the same shape `onChange` hands back.
	const [internal, setInternal] = createSignal<Record<string, string>>(
		props.value ?? {},
	);
	const answers = (): Record<string, string> =>
		props.value !== undefined ? props.value : internal();

	const blanks = () => new Map(props.question.blanks.map((b) => [b.id, b]));
	const graded = () => mode() === "review" && props.result !== undefined;

	function edit(id: string, next: string): void {
		const merged = { ...answers(), [id]: next };
		setInternal(merged);
		props.onChange?.(merged);
	}

	/** What a blank scored, or `undefined` when it was left empty or is ungraded. */
	const verdict = (id: string): number | undefined =>
		graded() ? props.result?.blanks?.[id] : undefined;

	/** The choices of a choice blank, for spelling an id back as its text. */
	const choiceText = (blank: PublicFillInBlank, id: string): string =>
		blank.type === "multiple-choice"
			? (blank.choices.find((choice) => choice.id === id)?.text ?? id)
			: id;

	const feedback = () => props.result?.choices ?? [];

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

			{/*
			 * A tall line rather than the default: every control is an `input`
			 * taller than a line of text, and a sentence carrying three of them
			 * collides with the line above it at any normal leading.
			 */}
			<p class="text-base font-medium leading-[2.75]">
				<For each={parseFillInStem(props.question.stem)}>
					{(segment) => (
						<Switch
							fallback={
								/*
								 * A reference the question declares no blank for. It stays
								 * in the sentence exactly as written: there is no control
								 * to draw, and a silently vanishing `[^typo]` gives an
								 * author nothing to go on.
								 */
								<span class="font-mono text-sm text-warning">
									[^{segment.kind === "blank" ? segment.id : ""}]
								</span>
							}
						>
							<Match when={segment.kind === "markdown" && segment}>
								{(markdown) => <Markdown inline text={markdown().text} />}
							</Match>
							<Match
								when={segment.kind === "blank" && blanks().get(segment.id)}
							>
								{(blank) => (
									<span class="mx-1 inline-flex items-center gap-1 align-middle">
										<BlankControl
											blank={blank()}
											value={answers()[blank().id] ?? ""}
											onChange={(next) => edit(blank().id, next)}
											disabled={mode() !== "answer"}
										/>
										<Show when={verdict(blank().id) !== undefined}>
											<Show
												when={(verdict(blank().id) ?? 0) > 0}
												fallback={<XIcon />}
											>
												<CheckIcon />
											</Show>
										</Show>
									</span>
								)}
							</Match>
						</Switch>
					)}
				</For>
			</p>

			<Show when={props.question.epilogue}>
				<div class="text-base-content/70">
					<Markdown text={props.question.epilogue} />
				</div>
			</Show>

			<Show when={graded() && feedback().length > 0}>
				<ul class="flex flex-col gap-2">
					<For each={feedback()}>
						{(entry) => (
							<li class="rounded-box border border-base-300 bg-base-200/40 px-4 py-2 text-sm">
								<span class="font-mono text-xs text-base-content/60">
									{entry.id}
								</span>{" "}
								&mdash; {entry.feedback}
							</li>
						)}
					</For>
				</ul>
			</Show>

			<Show when={graded() && props.result?.correct !== undefined}>
				<div class="rounded-box border border-info/40 bg-info/5 p-4">
					<h4 class="mb-2 text-sm font-semibold text-info">Expected</h4>
					<dl class="flex flex-col gap-1 text-sm">
						<For each={props.question.blanks}>
							{(blank) => (
								<div class="flex flex-wrap items-baseline gap-2">
									<dt class="font-mono text-xs text-base-content/60">
										{blank.id}
									</dt>
									<dd class="flex flex-wrap gap-2">
										<For
											each={props.result?.correct?.[blank.id] ?? []}
											fallback={
												<span class="text-base-content/50">
													Not shown for this blank
												</span>
											}
										>
											{(id) => (
												<span class="badge badge-outline">
													{choiceText(blank, id)}
												</span>
											)}
										</For>
									</dd>
								</div>
							)}
						</For>
					</dl>
				</div>
			</Show>
		</div>
	);
}

interface BlankControlProps {
	blank: PublicFillInBlank;
	value: string;
	onChange: (next: string) => void;
	disabled: boolean;
}

/**
 * The one control a blank is answered with, sized to sit inside a sentence.
 *
 * A choice blank is a `ChoiceSelect`, not a stack of radio cards: the blank is
 * *in* the sentence, and a card list cannot go there. Only the grading is
 * shared with multiple choice — see `dev/specs/to-review/question-fill-in.md`,
 * "Share the model, not the markup".
 */
function BlankControl(props: BlankControlProps): JSX.Element {
	// daisyUI fades a disabled control's border to nearly the page colour. The
	// standalone views can afford that — their box always holds the answer, and
	// the text keeps its colour — but a blank the student left empty has no text
	// to carry it, and a frozen sentence would show a gap where a question was.
	//
	// Keyed off the prop rather than the `disabled:` variant, because the
	// numeric box's border lives on the `<label>` wrapping the input, and a
	// label is never itself disabled for the variant to match.
	const frozen = () => (props.disabled ? "border-base-content/25" : "");

	return (
		<Switch>
			<Match when={props.blank.type === "multiple-choice" && props.blank}>
				{(blank) => (
					<ChoiceSelect
						choices={blank().choices}
						value={props.value}
						onChange={props.onChange}
						disabled={props.disabled}
						ariaLabel={blank().id}
						class={frozen()}
					/>
				)}
			</Match>

			<Match when={props.blank.type === "numeric" && props.blank}>
				{(blank) => (
					<NumericInput
						class={`input-sm align-middle ${frozen()} ${blank().unit ? "w-44" : "w-28"}`}
						domain={blank().domain}
						unit={blank().unit}
						decimalPlaces={blank().decimalPlaces}
						text={props.value}
						onChange={(_value, next) => props.onChange(next)}
						disabled={props.disabled}
						placeholder="?"
						ariaLabel={blank().id}
					/>
				)}
			</Match>

			<Match when={props.blank.type === "short-answer" && props.blank}>
				{(blank) => (
					<TextInput
						class={`input-sm w-36 align-middle ${frozen()}`}
						value={props.value}
						onChange={props.onChange}
						disabled={props.disabled}
						placeholder="?"
						ariaLabel={blank().id}
					/>
				)}
			</Match>
		</Switch>
	);
}
