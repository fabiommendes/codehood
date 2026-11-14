/**
 * Answer field of an essay question with `content: "code"` whose language
 * has a runner driver: the question text around a `CodeRunner` in `answer`
 * mode, with autosave status and the local draft.
 */

import type { LanguageId } from "@codehood/runner/protocol";
import { Markdown } from "mdq/solid";
import { createEffect, createSignal, type JSX, onMount, Show } from "solid-js";
import {
	AttachmentList,
	type AttachmentListProps,
} from "@/components/question/AttachmentList";
import { m } from "@/i18n";
import { formatDateTime } from "@/utils/schedule-time";
import { CodeRunner } from "../runner/CodeRunner";
import {
	type CodeDraft,
	compareDraft,
	type DraftRef,
	type DraftStore,
	draftStore,
} from "./code-draft";

/** Where the autosave of this answer stands, as `ExamAttempt` tracks it. */
export interface CodeAnswerSaveState {
	/// `saved`: the server has the current code. `saving`: a save is in
	/// flight (shown only once it is slow). `unsaved`: an edit is waiting.
	state: "saved" | "saving" | "unsaved";
	/// When the server last confirmed a save in this page; null before the first.
	savedAt: Date | null;
	/// Since when saves have been failing; null while they succeed.
	failingSince: Date | null;
}

export interface CodeEssayAnswerProps {
	/// Stem and epilogue in Markdown, as in the public essay question.
	stem: string;
	epilogue?: string;
	language: LanguageId;
	/// The server's saved answer; `""` when there is none.
	value: string;
	/// When the server saved `value`, on the server's clock; null when there is no answer.
	valueSavedAt: Date | null;
	/// `serverNow - clientNow` in milliseconds, measured when the page loaded;
	/// added to client times so drafts compare on the server's clock.
	clockOffsetMs: number;
	/// Called with the full code after each edit, and the editor's user event behind it when known; `ExamAttempt` debounces and saves.
	onChange: (code: string, userEvent?: string) => void;
	save: CodeAnswerSaveState;
	/// From `canRunCode(exam)`.
	codeRun: boolean;
	runnerOrigin: string | null;
	draft: DraftRef;
	/// Called when an unresolved draft conflict appears (with the comparison)
	/// and when the student resolves it (with null). `ExamAttempt` lists the
	/// questions in conflict in the submit dialog and, on the automatic
	/// submission at the deadline, keeps the `newer` version: when it is the
	/// draft, it saves `draftCode` before submitting.
	onConflict: (
		conflict: { newer: "draft" | "server"; draftCode: string } | null,
	) => void;
	/// The files the question attaches, listed under the stem.
	attachments?: AttachmentListProps["attachments"];
	/// The download URL of an attachment by name; null when the page has none.
	attachmentUrl?: AttachmentListProps["url"];
	/// Code the editor starts with when there is no answer and no draft.
	/// Reserved for starter code from the question; nothing sets it yet.
	starterCode?: string;
	/// False keeps no local draft at all, for an answer that is never saved (the instructor's preview).
	keepDraft?: boolean;
}

/**
 * Renders the stem, the code editor and the epilogue.
 *
 * Stem and epilogue go through the `Markdown` component of mdq-js, inside
 * `.mdq-stem` and `.mdq-epilogue`, exactly as mdq's `Essay` renders them: no
 * other path turns question text into HTML.
 *
 * On mount it reads the local draft and compares it with `value`
 * (`compareDraft`). `same` drops the draft; `conflict` shows both versions
 * side by side, as plain text with their times, and keeps Run and the editor
 * off until the student picks one; the pick is written through `onChange`
 * when it is the draft. Each edit writes the draft and calls `onChange`.
 * When `value` is saved and equals the draft, the draft is removed.
 *
 * The footer shows "Saved at HH:MM", "Saving…", or, while saves fail, that
 * the server has not received the changes since `failingSince` and the draft
 * is kept in this browser. Running never saves anything.
 */
export function CodeEssayAnswer(props: CodeEssayAnswerProps): JSX.Element {
	let store: DraftStore | null = null;
	const [conflict, setConflict] = createSignal<CodeDraft | null>(null);
	const [checked, setChecked] = createSignal(false);
	const [generation, setGeneration] = createSignal(1);
	const [startCode, setStartCode] = createSignal(
		props.value !== "" ? props.value : (props.starterCode ?? ""),
	);

	/// The current time on the server's clock.
	const serverNow = () => Date.now() + props.clockOffsetMs;

	/// Replaces the editor's content, which `CodeRunner` only reads at mount.
	function restart(code: string): void {
		setStartCode(code);
		setGeneration((value) => value + 1);
	}

	onMount(() => {
		try {
			if (props.keepDraft !== false) store = draftStore(window.localStorage);
		} catch {
			// Storage unavailable (privacy mode): no drafts, the autosave remains.
		}
		const draft = store?.read(props.draft, serverNow()) ?? null;
		const found = compareDraft(
			draft,
			props.value,
			props.valueSavedAt?.getTime() ?? null,
		);
		if (found.kind === "same") store?.remove(props.draft);
		if (found.kind === "conflict" && draft) {
			setConflict(draft);
			props.onConflict({ newer: found.newer, draftCode: draft.code });
		}
		setChecked(true);
	});

	// Once the server holds the current code, the local copy has no use, unless
	// another tab of the same exam wrote different code to it meanwhile.
	let lastEdit: string | null = null;
	createEffect(() => {
		if (checked() && conflict() === null && props.save.state === "saved") {
			const stored = store?.read(props.draft, serverNow());
			if (stored && stored.code === lastEdit) store?.remove(props.draft);
		}
	});

	function edited(code: string, userEvent?: string): void {
		lastEdit = code;
		store?.write(props.draft, { code, savedAt: serverNow() });
		props.onChange(code, userEvent);
	}

	function keepDraft(draft: CodeDraft): void {
		edited(draft.code);
		restart(draft.code);
		setConflict(null);
		props.onConflict(null);
	}

	function useServer(): void {
		store?.remove(props.draft);
		restart(props.value);
		setConflict(null);
		props.onConflict(null);
	}

	const savedAt = () => props.save.savedAt ?? props.valueSavedAt;

	const footer = () => (
		<div
			role="status"
			class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-base-300 bg-base-200/50 px-3 py-1.5 text-xs"
			data-code-footer
		>
			<Show when={!props.codeRun}>
				<span class="text-muted">{m.exams_code_run_off_hint()}</span>
			</Show>
			<Show
				when={props.save.failingSince}
				fallback={
					<Show
						when={props.save.state === "saving"}
						fallback={
							<Show when={savedAt()}>
								{(at) => (
									<span
										class={`text-muted transition-opacity ${props.save.state === "unsaved" ? "opacity-40" : ""}`}
										data-save="saved"
									>
										{m.exams_code_saved_at({ time: clockOf(at()) })}
									</span>
								)}
							</Show>
						}
					>
						<span class="text-muted" data-save="saving">
							{m.exams_attempt_saving()}
						</span>
					</Show>
				}
			>
				{(since) => (
					<span class="text-error" data-save="failing">
						{m.exams_code_save_failing({ time: clockOf(since()) })}
					</span>
				)}
			</Show>
		</div>
	);

	return (
		<div
			class="mdq-question"
			data-type="essay"
			data-mode="answer"
			data-content="code"
		>
			<div class="mdq-stem">
				<Markdown text={props.stem} />
			</div>
			<AttachmentList
				attachments={props.attachments}
				url={props.attachmentUrl ?? (() => null)}
			/>

			<Show
				when={conflict()}
				fallback={
					<Show when={generation()} keyed>
						{(_generation) => (
							<CodeRunner
								mode="answer"
								language={props.language}
								code={startCode()}
								label={m.exams_code_answer_label()}
								runnerOrigin={props.runnerOrigin}
								runDisabled={!props.codeRun}
								onChange={edited}
								starterCode={props.starterCode}
								compact
								footer={footer()}
							/>
						)}
					</Show>
				}
			>
				{(draft) => (
					<ConflictPanel
						draft={draft()}
						server={props.value}
						serverSavedAt={props.valueSavedAt}
						onKeepDraft={() => keepDraft(draft())}
						onUseServer={useServer}
					/>
				)}
			</Show>

			<Show when={props.epilogue}>
				<div class="mdq-epilogue">
					<Markdown text={props.epilogue} />
				</div>
			</Show>
		</div>
	);
}

/// "14:32" in the server's time zone.
function clockOf(date: Date | number): string {
	return formatDateTime(new Date(date), {
		weekday: undefined,
		month: undefined,
		day: undefined,
	});
}

/// The draft and the server's answer side by side as plain text, one button each; Run waits for the pick.
function ConflictPanel(props: {
	draft: CodeDraft;
	server: string;
	serverSavedAt: Date | null;
	onKeepDraft: () => void;
	onUseServer: () => void;
}): JSX.Element {
	const side = (
		title: string,
		time: string,
		code: string,
		label: string,
		pick: () => void,
		kind: string,
	) => (
		<div
			class="rounded-box border border-base-300 bg-base-100"
			data-conflict-side={kind}
		>
			<div class="flex items-center justify-between px-3 py-1.5 text-xs">
				<span class="font-semibold">{title}</span>
				<span class="text-muted">{time}</span>
			</div>
			<pre class="max-h-28 overflow-auto bg-base-200 px-3 py-2 font-mono text-xs leading-5">
				{code}
			</pre>
			<div class="p-2">
				<button type="button" class="btn btn-sm btn-block" onClick={pick}>
					{label}
				</button>
			</div>
		</div>
	);
	return (
		<div
			class="overflow-hidden rounded-box border border-warning/40 bg-warning/10 text-sm"
			data-code-conflict
		>
			<div class="flex flex-wrap items-center gap-2 border-b border-warning/40 px-3 py-1.5">
				<span class="ml-auto" title={m.exams_code_pick_first()}>
					<button
						type="button"
						class="btn btn-soft btn-success btn-sm"
						data-action="run"
						disabled
					>
						{m.runner_run()}
					</button>
				</span>
			</div>
			<div class="p-3">
				<p class="font-semibold">{m.exams_code_conflict_title()}</p>
				<p class="mt-0.5 text-xs text-base-content/70">
					{m.exams_code_conflict_body()}
				</p>
				<div class="mt-3 grid gap-3 sm:grid-cols-2">
					{side(
						m.exams_code_conflict_browser(),
						m.exams_code_conflict_browser_time({
							time: clockOf(props.draft.savedAt),
						}),
						props.draft.code,
						m.exams_code_keep_draft(),
						props.onKeepDraft,
						"draft",
					)}
					{side(
						m.exams_code_conflict_server(),
						props.serverSavedAt
							? m.exams_code_conflict_server_time({
									time: clockOf(props.serverSavedAt),
								})
							: m.exams_code_conflict_server_empty(),
						props.server,
						m.exams_code_use_server(),
						props.onUseServer,
						"server",
					)}
				</div>
			</div>
		</div>
	);
}
