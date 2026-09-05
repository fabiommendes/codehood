import {
	createEffect,
	createMemo,
	createSignal,
	createUniqueId,
	type JSX,
	Match,
	type ParentProps,
	Show,
	Switch,
} from "solid-js";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import type { PublicEssay } from "@/mdq/public";
import type { QuestionResult } from "@/mdq/scoring";
import Markdown from "./Markdown";
import {
	feedbackVariant,
	PENDING_LABEL,
	pendingBadge,
	scoreBadge,
	scoreLabel,
} from "./scoreDisplay";
import type { QuestionMode } from "./types";

export interface EssayViewProps {
	question: PublicEssay;
	value?: string;
	onChange?: (text: string) => void;
	mode?: QuestionMode;
	result?: QuestionResult<"essay">;
}

/**
 * Renders a `PublicEssay` question.
 *
 * Outside `answer` mode the submitted text is rendered as content rather than
 * shown in a disabled textarea. The other views freeze by disabling their
 * controls because a frozen toggle still displays what it holds; a textarea
 * does not — it hides everything past its own height behind a scrollbar the
 * student can no longer use. See `dev/specs/to-do/question-essay.md`, "Frozen
 * essays are rendered, not disabled".
 */
export default function EssayView(props: EssayViewProps): JSX.Element {
	const mode = () => props.mode ?? "answer";
	const name = createUniqueId();
	const feedbackId = `${name}-feedback`;
	const inputId = `${name}-answer`;

	// `text` is the schema's default, and the one that decides whether the
	// answer is read as Markdown.
	const input = () => props.question.input ?? "text";

	// Uncontrolled fallback: seeded from `value` once, then tracked locally so
	// the textarea works even when the caller passes no `onChange`.
	const [internalValue, setInternalValue] = createSignal(props.value ?? "");
	const text = () =>
		props.value !== undefined ? props.value : internalValue();

	// Withheld means the key is absent. An empty one means the question carries
	// no model answer at all — the schema forbids a blank `answerKey` — so both
	// render nothing, unlike the choice types where an empty key is a real key.
	const modelAnswer = createMemo(() => props.result?.correct || undefined);

	// `pending` and a zero score are different things: a human who read the
	// essay and marked it worthless also scores 0.
	const graded = () => props.result !== undefined && !props.result.pending;

	function edit(next: string): void {
		setInternalValue(next);
		props.onChange?.(next);
	}

	return (
		<div class="flex flex-col gap-4">
			<Show when={mode() === "review" && props.result}>
				{(result) => (
					<div class="flex justify-end">
						<Show
							when={graded()}
							fallback={<Badge {...pendingBadge()}>{PENDING_LABEL}</Badge>}
						>
							<Badge {...scoreBadge(result().score)}>
								{scoreLabel(result().score)}
							</Badge>
						</Show>
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

			<Show
				when={mode() === "answer"}
				fallback={
					<Panel label="Your answer">
						<AnswerText input={input()} text={text()} />
					</Panel>
				}
			>
				<div class="flex flex-col gap-2">
					<Show when={input() === "code" && props.question.highlight}>
						{(language) => (
							<div class="flex justify-end">
								<Badge style="outline" size="sm">
									{language()}
								</Badge>
							</div>
						)}
					</Show>
					{/*
					 * The text goes in as children, not only as `value`: HTML has no
					 * `value` attribute for a textarea, so a server-rendered one comes
					 * back empty and the answer is gone until hydration. The ref keeps
					 * it in step afterwards, since children are only the default value.
					 */}
					<textarea
						id={inputId}
						ref={(el) => {
							createEffect(() => {
								if (el.value !== text()) el.value = text();
							});
						}}
						class={
							input() === "code"
								? "textarea h-56 w-full font-mono text-sm"
								: "textarea h-40 w-full"
						}
						spellcheck={input() !== "code"}
						placeholder={
							input() === "code"
								? "Write your code here…"
								: "Write your answer here…"
						}
						onInput={(event) => edit(event.currentTarget.value)}
						aria-describedby={props.result?.feedback ? feedbackId : undefined}
					>
						{text()}
					</textarea>
					<Show when={input() === "text"}>
						<p class="text-xs text-base-content/60">Markdown is supported.</p>
					</Show>
				</div>
			</Show>

			<Show when={props.question.epilogue}>
				<div class="text-base-content/70">
					<Markdown text={props.question.epilogue} />
				</div>
			</Show>

			<Show when={mode() === "review" && modelAnswer()}>
				{(answer) => (
					<Panel label="Model answer" tone="info">
						<AnswerText input={input()} text={answer()} />
					</Panel>
				)}
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

/**
 * A labelled block around one body of prose.
 *
 * The student's answer gets one as well as the model answer, because the two
 * are otherwise the same rendered Markdown stacked one above the other, and a
 * student reading the model answer as their own is the single confusion this
 * screen must not create.
 */
function Panel(
	props: ParentProps<{ label: string; tone?: "info" }>,
): JSX.Element {
	return (
		<div
			class={
				props.tone === "info"
					? "rounded-box border border-info/40 bg-info/5 p-4"
					: "rounded-box border border-base-300 p-4"
			}
		>
			<h4
				class={
					props.tone === "info"
						? "mb-2 text-sm font-semibold text-info"
						: "mb-2 text-sm font-semibold text-base-content/60"
				}
			>
				{props.label}
			</h4>
			{props.children}
		</div>
	);
}

/**
 * Renders a written answer the way its `input` kind says it was meant to be
 * read: Markdown for `text`, preserved whitespace for `plain`, and a code
 * mockup for `code`.
 */
function AnswerText(props: { input: string; text: string }): JSX.Element {
	return (
		<Switch
			fallback={
				<p class="text-sm italic text-base-content/50">No answer submitted.</p>
			}
		>
			<Match when={props.text.trim() && props.input === "code"}>
				<div class="mockup-code w-full text-sm">
					<pre>
						<code>{props.text}</code>
					</pre>
				</div>
			</Match>
			<Match when={props.text.trim() && props.input === "plain"}>
				<pre class="whitespace-pre-wrap text-sm">{props.text}</pre>
			</Match>
			<Match when={props.text.trim()}>
				<Markdown text={props.text} />
			</Match>
		</Switch>
	);
}
