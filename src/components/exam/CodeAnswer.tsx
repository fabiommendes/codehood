/**
 * Answer field of an MDQ `code` question: the stem, the example tests, a code
 * editor and the pretest run.
 */

import type { LanguageId } from "@codehood/runner/protocol";
import { firstFencedCode, type PublicCodeQuestion } from "mdq";
import { Markdown } from "mdq/solid";
import {
	createSignal,
	For,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import { m } from "@/i18n";
import { languageLabel } from "@/runner/languages";
import type { PretestSource } from "@/utils/pretest-sources";
import { createEditor, type RunnerEditor } from "../runner/editor";
import {
	type ReportCase,
	type RunnerReport,
	runTests as runBrowserTests,
	type Verdict,
} from "../runner/run-tests";
import { type PretestSummary, summarizeReport } from "./code-pretest";

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
	/// Runs the pretests; the browser runner by default. Tests inject their own.
	runTests?: typeof runBrowserTests;
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
		if (state().kind === "running" || props.pretests.length === 0) return;
		controller = new AbortController();
		const { signal } = controller;
		const ranCode = code();
		setState({ kind: "running" });
		try {
			const report = await (props.runTests ?? runBrowserTests)(
				{
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

	const running = () => state().kind === "running";
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

			<Show when={examples.length > 0}>
				<section class="flex flex-col gap-2" data-code-examples>
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
						{m.code_examples_title()}
					</h3>
					<For each={examples}>
						{(example) => (
							<div
								class="overflow-hidden rounded-box border border-base-300 bg-base-200/50"
								data-example
								data-format={example.format}
							>
								<div class="border-b border-base-300 px-3 py-1 text-xs text-muted">
									{m.code_example_from_line({
										line: String(example.firstLine),
									})}
								</div>
								<pre class="m-0 overflow-x-auto py-2 font-mono text-xs leading-5">
									<code>
										<For each={example.text.split("\n")}>
											{(line, index) => (
												<div class="flex">
													<span class="w-10 shrink-0 select-none pr-3 text-right tabular-nums text-base-content/40">
														{example.firstLine + index()}
													</span>
													<span class="whitespace-pre pr-3">{line}</span>
												</div>
											)}
										</For>
									</code>
								</pre>
							</div>
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
							disabled={running() || props.pretests.length === 0}
							onClick={() => void runPretests()}
						>
							<Show when={running()}>
								<span class="loading loading-spinner loading-xs" />
							</Show>
							{running() ? m.code_pretest_running() : m.code_pretest_run()}
						</button>
					</div>
				</div>
				<Show when={!ready()}>
					<pre
						class="m-0 min-h-24 overflow-x-auto bg-base-100 px-3 py-2 font-mono text-sm leading-5"
						data-editor-static
					>
						<code>{code()}</code>
					</pre>
				</Show>
				<div ref={editorParent} class={ready() ? "" : "hidden"} data-editor />
				<div class="border-t border-base-300 bg-base-200/50 px-3 py-1.5 text-xs text-muted">
					{props.pretests.length === 0
						? m.code_pretest_none()
						: m.code_pretest_hint()}
				</div>
			</div>

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
					<pre class="m-0 max-h-60 overflow-auto rounded-box border border-error/30 bg-error/5 px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap">
						{message()}
					</pre>
				)}
			</Show>
			<Show when={summary().kind === "runner-error" && props.report.message}>
				{(message) => <p class="text-xs text-muted">{message()}</p>}
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
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span
					class={`badge badge-soft badge-sm ${verdictClass(props.item.verdict)}`}
				>
					{VERDICT_LABEL[props.item.verdict]()}
				</span>
				<span class="font-mono text-xs">
					{props.item.id ?? m.code_case_untitled({ n: String(props.n) })}
				</span>
				<Show when={props.item.message}>
					{(message) => <span class="text-base-content/80">{message()}</span>}
				</Show>
			</div>
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
