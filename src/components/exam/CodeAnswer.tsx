/**
 * Answer field of an MDQ `code` question: the stem, the example tests, a code
 * editor and the pretest run.
 */

import type { LanguageId } from "@codehood/runner/protocol";
import { firstFencedCode, type PublicCodeQuestion } from "mdq";
import { Markdown } from "mdq/solid";
import {
	createMemo,
	createSignal,
	For,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import {
	AttachmentList,
	type AttachmentListProps,
} from "@/components/question/AttachmentList";
import { m } from "@/i18n";
import { languageLabel } from "@/runner/languages";
import type { PretestSource } from "@/utils/pretest-sources";
import { AnsiText } from "../runner/AnsiText";
import { createEditor, type RunnerEditor } from "../runner/editor";
import { EDITOR_FOCUS_RING, EDITOR_SURFACE } from "../runner/editor-surface";
import {
	type ReportCase,
	type RunnerReport,
	runTests as runBrowserTests,
	type Verdict,
} from "../runner/run-tests";
import {
	type PretestSummary,
	pretestOffReason,
	summarizeReport,
} from "./code-pretest";
import { type CodeSends, nextSendWorth, type SentView } from "./code-sends";

export interface CodeAnswerProps {
	/// The public form: the stem, the `template`, the `language`, the `file`
	/// and the `publicTests` it shows.
	question: PublicCodeQuestion;
	/// The sources the browser runs as pretests, from `pretestSources`. The
	/// host passes them because the public form holds only the public regions,
	/// and a runner needs the whole source.
	pretests: readonly PretestSource[];
	/// The student's code; `null` while there is no answer, and the editor then starts with the `template`.
	value: string | null;
	/// Called with the full code after each edit, and the editor's user event behind it when known.
	onChange: (code: string, userEvent?: string) => void;
	/// Origin of the runner frame (`RUNNER_ORIGIN`); null when the server has none.
	runnerOrigin?: string | null;
	/// The highlighted HTML of each example test, in the order of the `{example}` tests of `question.publicTests`, from `highlightExamples`. Trusted: never user HTML. Plain text shows without it.
	exampleHtml?: readonly string[];
	/// Sends the code to the grading queue, or rejects with the reason it was refused. The host passes it only for a question with a worker, and saves the answer first.
	onSubmit?: (code: string) => Promise<void>;
	/// The counter and the list of sends shown under the editor, kept up to date by the host.
	sends?: CodeSends;
	/// Runs the pretests; the browser runner by default. Tests inject their own.
	runTests?: typeof runBrowserTests;
	/// The files the question attaches, listed under the stem.
	attachments?: AttachmentListProps["attachments"];
	/// The download URL of an attachment by name; null when the page has none.
	attachmentUrl?: AttachmentListProps["url"];
}

/// The last pretest run, as the component shows it.
type PretestState =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "done"; report: RunnerReport; ranCode: string }
	| { kind: "unavailable"; message: string; ranCode: string };

const VERDICT_LABEL: Record<Verdict, () => string> = {
	pass: () => m.code_verdict_pass(),
	fail: () => m.code_verdict_fail(),
	error: () => m.code_verdict_error(),
	timeout: () => m.code_verdict_timeout(),
	"resource-limit": () => m.code_verdict_resource_limit(),
	skipped: () => m.code_verdict_skipped(),
};

/// Badge color of a verdict: only `pass` is green, `skipped` is neutral.
function verdictClass(verdict: Verdict): string {
	if (verdict === "pass") return "badge-success";
	if (verdict === "skipped") return "badge-ghost";
	return "badge-error";
}

/**
 * Renders the stem and the example tests, the editor started with the
 * `template` (or `value`) and the "Run pretests" button with its result.
 *
 * Pretests run `props.pretests` against the editor's code, whatever the exam
 * says about running code, and never save or submit anything. The result goes
 * stale, and is marked so, once the code changes after the run.
 */
export function CodeAnswer(props: CodeAnswerProps): JSX.Element {
	const language = props.question.language as LanguageId;
	const filename = props.question.file ?? "";
	const template = props.question.template
		? (firstFencedCode(props.question.template) ?? "")
		: "";
	const examples = (props.question.publicTests ?? []).filter(
		(test) => test.example,
	);

	const [code, setCode] = createSignal(props.value ?? template);
	const [ready, setReady] = createSignal(false);
	const [state, setState] = createSignal<PretestState>({ kind: "idle" });
	const [sending, setSending] = createSignal(false);
	const [notice, setNotice] = createSignal<{
		kind: "sent" | "refused";
		text: string;
	} | null>(null);
	/// Read once under the component, since the host's prop is a getter that builds a memo each time it is read, and a click has no owner to hold it.
	const onSubmit = createMemo(() => props.onSubmit);
	let editorParent!: HTMLDivElement;
	let editor: RunnerEditor | null = null;
	let disposed = false;
	let controller: AbortController | null = null;

	onMount(() => {
		void createEditor({
			parent: editorParent,
			doc: code(),
			language,
			readOnly: false,
			label: m.code_answer_label(),
			tabHint: m.runner_editor_tab_hint(),
			onChange: (value, userEvent) => {
				setCode(value);
				props.onChange(value, userEvent);
			},
			onRun: () => void runPretests(),
			onFocus: () => {},
		}).then((created) => {
			if (disposed) created.destroy();
			else {
				editor = created;
				setReady(true);
			}
		});
	});

	onCleanup(() => {
		disposed = true;
		controller?.abort();
		editor?.destroy();
	});

	async function runPretests(): Promise<void> {
		if (state().kind === "running" || offReason() !== null) return;
		controller = new AbortController();
		const { signal } = controller;
		const ranCode = code();
		setState({ kind: "running" });
		try {
			const report = await (props.runTests ?? runBrowserTests)(
				{
					runnerOrigin: props.runnerOrigin ?? null,
					language: props.question.language ?? "",
					file: filename,
					answer: ranCode,
					tests: props.pretests,
				},
				signal,
			);
			if (!signal.aborted) setState({ kind: "done", report, ranCode });
		} catch (error) {
			if (signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			setState({ kind: "unavailable", message, ranCode });
		}
	}

	async function submit(): Promise<void> {
		const send = onSubmit();
		if (!send || sending()) return;
		setSending(true);
		setNotice(null);
		try {
			await send(code());
			setNotice({ kind: "sent", text: m.code_submit_sent() });
		} catch (error) {
			const text = error instanceof Error ? error.message : String(error);
			setNotice({ kind: "refused", text });
		} finally {
			setSending(false);
		}
	}

	const nextWorth = () => (props.sends ? nextSendWorth(props.sends) : null);
	const exhausted = () =>
		props.sends?.limit != null && props.sends.used >= props.sends.limit;
	const running = () => state().kind === "running";
	const offReason = () =>
		pretestOffReason(props.pretests.length, props.runnerOrigin);
	const stale = () => {
		const current = state();
		return (
			(current.kind === "done" || current.kind === "unavailable") &&
			current.ranCode !== code()
		);
	};

	return (
		<div
			class="mdq-question flex flex-col gap-4"
			data-type="code"
			data-mode="answer"
		>
			<div class="mdq-stem">
				<Markdown text={props.question.stem} />
			</div>
			<AttachmentList
				attachments={props.attachments}
				url={props.attachmentUrl ?? (() => null)}
			/>

			<Show when={examples.length > 0}>
				<section class="flex flex-col gap-2" data-code-examples>
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
						{m.code_examples_title()}
					</h3>
					<For each={examples}>
						{(example, index) => (
							<details
								class="collapse collapse-arrow overflow-hidden rounded-box border border-base-300 bg-base-200/50"
								data-example
								data-format={example.format}
							>
								<summary class="collapse-title min-h-0 px-3 py-2 text-xs text-muted">
									{m.code_example_summary({
										line: String(example.firstLine),
									})}
								</summary>
								<div class="collapse-content p-0">
									<div
										class={`${EDITOR_SURFACE} [&_pre]:text-[13px] [&_pre]:leading-5`}
									>
										<ExampleCode
											text={example.text}
											firstLine={example.firstLine}
											html={props.exampleHtml?.[index()]}
										/>
									</div>
								</div>
							</details>
						)}
					</For>
				</section>
			</Show>

			<div
				class="overflow-hidden rounded-box border border-base-300 bg-base-100"
				data-code-editor
			>
				<div class="flex flex-wrap items-center gap-2 border-b border-base-300 bg-base-200/50 px-3 py-1.5">
					<span class="font-mono text-xs">{filename}</span>
					<span class="badge badge-ghost badge-xs">
						{languageLabel(language)}
					</span>
					<div class="ml-auto flex items-center gap-2">
						<button
							type="button"
							class="btn btn-soft btn-success btn-sm"
							data-action="run-pretests"
							disabled={running() || offReason() !== null}
							onClick={() => void runPretests()}
						>
							<Show when={running()}>
								<span class="loading loading-spinner loading-xs" />
							</Show>
							{running() ? m.code_pretest_running() : m.code_pretest_run()}
						</button>
						<Show when={onSubmit()}>
							<button
								type="button"
								class="btn btn-primary btn-sm"
								data-action="submit"
								disabled={sending() || exhausted()}
								onClick={() => void submit()}
							>
								<Show when={sending()}>
									<span class="loading loading-spinner loading-xs" />
								</Show>
								{sending() ? m.code_submit_sending() : m.code_submit()}
							</button>
						</Show>
					</div>
				</div>
				<div class={EDITOR_FOCUS_RING}>
					<div
						class={`${EDITOR_SURFACE} max-h-96 [font-variant-ligatures:none]`}
					>
						<Show when={!ready()}>
							<ExampleCode
								text={code()}
								firstLine={1}
								html={undefined}
								attributes={{ "data-editor-static": "" }}
							/>
						</Show>
						<div
							ref={editorParent}
							class={ready() ? "" : "hidden"}
							data-editor
						/>
					</div>
				</div>
				<div
					class="border-t border-base-300 bg-base-200/50 px-3 py-1.5 text-xs text-muted"
					data-pretest-hint={offReason() ?? "on"}
				>
					{offReason() === "no-runner"
						? m.code_pretest_no_runner()
						: offReason() === "no-pretests"
							? m.code_pretest_none()
							: m.code_pretest_hint()}
				</div>
			</div>

			<Show when={onSubmit()}>
				<div
					class="flex flex-wrap items-baseline gap-x-3 text-sm"
					role="status"
					aria-live="polite"
					data-submit-status={notice()?.kind ?? "idle"}
				>
					<span class="text-muted" data-submit-count>
						{props.sends?.limit == null
							? m.code_submit_used({ used: String(props.sends?.used ?? 0) })
							: m.code_submit_used_of({
									used: String(props.sends.used),
									limit: String(props.sends.limit),
								})}
					</span>
					<Show when={nextWorth() !== null}>
						<span class="text-muted" data-submit-worth>
							{m.code_submit_worth({ worth: String(nextWorth()) })}
						</span>
					</Show>
					<Show when={notice()}>
						{(current) => (
							<span
								class={
									current().kind === "sent" ? "text-success" : "text-error"
								}
							>
								{current().text}
							</span>
						)}
					</Show>
				</div>
			</Show>

			<Show when={props.sends && props.sends.submissions.length > 0}>
				<ol class="m-0 flex list-none flex-col gap-2 p-0" data-sends>
					<For each={props.sends?.submissions}>
						{(sent, index) => <SendRow sent={sent} n={index() + 1} />}
					</For>
				</ol>
			</Show>

			<div role="status" aria-live="polite" data-pretest-result>
				<Show when={state()} keyed>
					{(current) => (
						<Switch>
							<Match when={current.kind === "done" && current}>
								{(done) => (
									<PretestResult report={done().report} stale={stale()} />
								)}
							</Match>
							<Match when={current.kind === "unavailable" && current}>
								{(failed) => (
									<div
										class={`alert alert-error alert-soft text-sm ${stale() ? "opacity-60" : ""}`}
										data-status="unavailable"
									>
										{m.code_result_unavailable({ message: failed().message })}
									</div>
								)}
							</Match>
						</Switch>
					)}
				</Show>
			</div>
		</div>
	);
}

/// Code with line numbers starting at `firstLine`: the server-highlighted `html` when given, plain text otherwise.
function ExampleCode(props: {
	text: string;
	firstLine: number;
	html: string | undefined;
	attributes?: Record<string, string>;
}): JSX.Element {
	const lines = () => props.text.split("\n");
	const style = () => ({
		"--digits": String(String(props.firstLine + lines().length - 1).length),
		"counter-reset": `runner-line ${props.firstLine - 1}`,
	});
	return (
		<Show
			when={props.html}
			fallback={
				<pre
					class="m-0 px-0 py-2 whitespace-pre [font-variant-ligatures:none]"
					data-line-numbers
					style={style()}
					{...props.attributes}
				>
					<code>
						<For each={lines()}>
							{(line) => (
								<>
									<span class="line">{line}</span>
									{"\n"}
								</>
							)}
						</For>
					</code>
				</pre>
			}
		>
			{(html) => (
				<div
					class="[font-variant-ligatures:none] [&_pre]:m-0 [&_pre]:overflow-visible [&_pre]:bg-transparent [&_pre]:px-0 [&_pre]:py-2"
					data-line-numbers
					style={style()}
					innerHTML={html()}
				/>
			)}
		</Show>
	);
}

/// The state of a send in words, from its job and what the worker made of it.
function sendStatus(sent: SentView): string {
	switch (sent.jobState) {
		case "QUEUED":
			return m.code_send_queued();
		case "CLAIMED":
			return m.code_send_claimed();
		case "FAILED":
			return m.code_send_failed();
		case "CANCELLED":
			return m.code_send_cancelled();
		case "DONE":
			return sent.report?.outcome === "pretest-failed"
				? m.code_send_pretest_failed()
				: m.code_send_done();
		default:
			return m.code_send_sent();
	}
}

/// How a graded send weighs in the score of the question, once the exam shows it.
export interface SendWeight {
	score: number;
	/// The score after the discount for the earlier sends below 1.
	discounted: number;
	/// Whether this send is the one that sets the question's score.
	counts: boolean;
}

/// One send: its state, and, once the worker graded it, the public cases, the compiler message, the score (and its discount, with `weight`) and the rubric items the exam shows.
export function SendRow(props: {
	sent: SentView;
	n: number;
	weight?: SendWeight;
}): JSX.Element {
	const report = () => props.sent.report;
	const score = () => props.weight?.score ?? report()?.score;
	return (
		<li
			class="flex flex-col gap-2 rounded-box border border-base-300 px-3 py-2 text-sm"
			classList={{ "border-success/60 bg-success/5": props.weight?.counts }}
			data-send
			data-counts={props.weight?.counts ? "true" : undefined}
			data-job-state={props.sent.jobState ?? "none"}
		>
			<div class="flex flex-wrap items-baseline gap-x-3">
				<span class="font-semibold">
					{m.code_send_title({ n: String(props.n) })}
				</span>
				<span class="text-muted" data-send-status>
					{sendStatus(props.sent)}
				</span>
				<Show when={score() !== undefined}>
					<span class="font-semibold" data-send-score>
						{m.code_send_score({ score: String(round(score() as number)) })}
					</span>
				</Show>
				<Show
					when={
						props.weight && props.weight.discounted !== props.weight.score
							? props.weight
							: undefined
					}
				>
					{(weight) => (
						<span class="text-muted" data-send-discounted>
							{m.code_send_discounted({
								score: String(round(weight().discounted)),
							})}
						</span>
					)}
				</Show>
				<Show when={props.weight?.counts}>
					<span
						class="badge badge-success badge-soft badge-sm"
						data-send-counts
					>
						{m.code_send_counts()}
					</span>
				</Show>
			</div>
			<Show when={report()?.build}>
				{(build) => (
					<pre class="m-0 overflow-x-auto rounded-box border border-error/30 bg-error/5 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap">
						<AnsiText text={build()} />
					</pre>
				)}
			</Show>
			<Show when={(report()?.publicCases.length ?? 0) > 0}>
				<ul
					class="m-0 flex list-none flex-col divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 p-0"
					aria-label={m.code_result_cases()}
				>
					<For each={report()?.publicCases}>
						{(item, index) => (
							<CaseRow
								item={{ ...item, verdict: item.verdict as Verdict }}
								n={index() + 1}
							/>
						)}
					</For>
				</ul>
			</Show>
			<Show when={report()?.items}>
				{(items) => (
					<ul class="m-0 flex list-none flex-col gap-1 p-0" data-send-items>
						<For each={items()}>
							{(item) => (
								<li
									class="flex flex-col"
									data-passed={item.passed ? "true" : "false"}
								>
									<span class={item.passed ? "text-success" : "text-error"}>
										{item.passed ? "✓" : "✗"} {item.text}
									</span>
									<Show when={item.feedback}>
										{(feedback) => (
											<span class="pl-4 text-xs text-muted">{feedback()}</span>
										)}
									</Show>
								</li>
							)}
						</For>
					</ul>
				)}
			</Show>
		</li>
	);
}

/// The score without the float noise of a discount.
function round(score: number): number {
	return Math.round(score * 100) / 100;
}

/// The status line and one row per case of a finished run.
function PretestResult(props: {
	report: RunnerReport;
	stale: boolean;
}): JSX.Element {
	const summary = (): PretestSummary => summarizeReport(props.report);
	return (
		<div
			class={`flex flex-col gap-2 transition-opacity ${props.stale ? "opacity-60" : ""}`}
			data-status={summary().kind}
		>
			<div class="flex flex-wrap items-baseline gap-x-3 text-sm font-semibold">
				<span class={summaryClass(summary())}>{summaryText(summary())}</span>
				<Show when={props.stale}>
					<span class="text-xs font-normal text-muted" data-stale>
						{m.code_pretest_stale()}
					</span>
				</Show>
			</div>
			<Show when={buildMessage(summary())}>
				{(message) => (
					<pre class="m-0 overflow-x-auto rounded-box border border-error/30 bg-error/5 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap">
						<AnsiText text={message()} />
					</pre>
				)}
			</Show>
			<Show when={summary().kind === "runner-error" && props.report.message}>
				{(message) => (
					<p class="text-xs text-muted whitespace-pre-wrap">
						<AnsiText text={message()} />
					</p>
				)}
			</Show>
			<Show when={props.report.status === "completed"}>
				<ul
					class="m-0 flex list-none flex-col divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 p-0"
					aria-label={m.code_result_cases()}
				>
					<For each={props.report.cases}>
						{(item, index) => <CaseRow item={item} n={index() + 1} />}
					</For>
				</ul>
			</Show>
		</div>
	);
}

/// The compiler message of a build error, or null.
function buildMessage(summary: PretestSummary): string | null {
	return summary.kind === "build-error" && summary.build ? summary.build : null;
}

function summaryText(summary: PretestSummary): string {
	switch (summary.kind) {
		case "passed":
			return m.code_result_passed({ total: String(summary.total) });
		case "failed":
			return m.code_result_failed({
				failed: String(summary.failed),
				total: String(summary.total),
			});
		case "build-error":
			return m.code_result_build_error();
		case "runner-error":
			return m.code_result_runner_error();
	}
}

function summaryClass(summary: PretestSummary): string {
	return summary.kind === "passed" ? "text-success" : "text-error";
}

/// One case: verdict, id (or its position), message, and expected/actual when the report has them.
function CaseRow(props: { item: ReportCase; n: number }): JSX.Element {
	return (
		<li
			class="flex flex-col gap-1 px-3 py-2 text-sm"
			data-verdict={props.item.verdict}
		>
			<div class="flex items-start justify-between gap-2">
				<span
					class={`min-w-0 font-mono text-xs break-words ${props.item.verdict === "pass" ? "" : "font-bold text-error"}`}
					data-case-id
				>
					{props.item.id ?? m.code_case_untitled({ n: String(props.n) })}
				</span>
				<span
					class={`badge badge-soft badge-sm shrink-0 ${verdictClass(props.item.verdict)}`}
				>
					{VERDICT_LABEL[props.item.verdict]()}
				</span>
			</div>
			<Show when={props.item.message}>
				{(message) => (
					<pre
						class="m-0 overflow-x-auto rounded-box bg-base-200/60 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap text-base-content/80"
						data-case-message
					>
						<AnsiText text={message()} />
					</pre>
				)}
			</Show>
			<Show
				when={
					props.item.expected !== undefined || props.item.actual !== undefined
				}
			>
				<dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
					<Show when={props.item.expected !== undefined}>
						<dt class="text-muted">{m.code_case_expected()}</dt>
						<dd class="m-0 whitespace-pre-wrap break-all">
							{props.item.expected}
						</dd>
					</Show>
					<Show when={props.item.actual !== undefined}>
						<dt class="text-muted">{m.code_case_actual()}</dt>
						<dd class="m-0 whitespace-pre-wrap break-all">
							{props.item.actual}
						</dd>
					</Show>
				</dl>
			</Show>
		</li>
	);
}
