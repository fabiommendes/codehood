import { actions } from "astro:actions";
import {
	createEffect,
	createSignal,
	For,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import EssayView from "@/components/question/EssayView";
import FillInView from "@/components/question/FillInView";
import MultipleChoiceView from "@/components/question/MultipleChoiceView";
import MultipleSelectionView from "@/components/question/MultipleSelectionView";
import NumericView from "@/components/question/NumericView";
import ShortAnswerView from "@/components/question/ShortAnswerView";
import TrueFalseView from "@/components/question/TrueFalseView";
import type { Exam, QuestionPublic } from "@/db";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import type {
	PublicEssay,
	PublicFillIn,
	PublicMultipleChoice,
	PublicMultipleSelection,
	PublicNumeric,
	PublicShortAnswer,
	PublicTrueFalse,
} from "@/mdq/public";
import {
	type ExamResult,
	formatScore,
	type QuestionOutcome,
} from "@/services/exam-result";
import type { AttemptState } from "@/services/exam-state";
import { formatRelative } from "@/utils/relative-time";
import { formatDateTime } from "@/utils/schedule-time";
import {
	type AnswerPayload,
	answersOf,
	blanksOf,
	choiceOf,
	choicesOf,
	essayOf,
	fromAnswers,
	fromChoices,
	isAnswered,
	isTextEntry,
	numberOf,
	textOf,
} from "./answer-payload";
import RegradeControls, { type QuestionRegrade } from "./RegradeControls";

export interface ExamAttemptProps {
	/// The course's URL segments and the exam slug, as the exam actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// The exam type, which picks how sentences and buttons refer to the exam.
	type: Exam["type"];
	/// Where the viewing student stands, computed on the server at `now`.
	state: AttemptState;
	/// Server time when the page rendered, so the countdown ignores client clock skew.
	now: Date;
	/// The exam's questions, public half only, in exam order.
	questions: { slug: string; question: QuestionPublic["question"] }[];
	/// The student's latest answer per question slug.
	answers: Record<string, AnswerPayload>;
	/// The graded outcome per question, present once the grades are released.
	result?: ExamResult;
	/// What the student may do about the regrade of each question's answer, by question slug.
	regrades?: Record<string, QuestionRegrade>;
}

/// The box every state sentence of an attempt sits in.
const NOTICE = "rounded-box border border-base-300 bg-base-200 p-4 text-sm";

/// How long typing pauses before a text answer is saved.
const SAVE_DELAY_MS = 500;

/// Whole seconds from `now` until `deadline`, never negative.
function secondsLeft(deadline: Date, now: Date): number {
	return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000));
}

/// The time left as "42 min left", or seconds in the last minute.
function timeLeft(seconds: number): string {
	if (seconds < 60) return m.exams_attempt_seconds_left({ seconds });
	return m.exams_attempt_minutes_left({ minutes: Math.ceil(seconds / 60) });
}

/// The colour of the time left: warning in the last five minutes, error in the last one.
function timeClass(seconds: number): string {
	if (seconds < 60) return "text-error";
	if (seconds <= 5 * 60) return "text-warning";
	return "";
}

/// Where a question lands when its number is picked: below the top bar and the attempt bar.
const QUESTION_SCROLL_MARGIN = "scroll-mt-48";

/**
 * A student's side of an exam page: the one action their state allows, and the questions.
 *
 * `not-open` shows when the exam opens; `can-start` offers "Start <type>";
 * `in-progress` renders the questions in answer mode, saves each answer as it
 * changes, and keeps a bar in view with the time left, the questions
 * answered, whether everything is saved, and "Submit <type>" behind a
 * confirmation; `submitted` shows the saved answers read-only; `results`
 * adds the score and comments on each answer; `missed` says the student did
 * not take it.
 */
export default function ExamAttempt(props: ExamAttemptProps): JSX.Element {
	const target = {
		discipline: props.discipline,
		course: props.course,
		exam: props.exam,
	};

	const skew = props.now.getTime() - Date.now();
	const serverNow = () => new Date(Date.now() + skew);

	const [kind, setKind] = createSignal(props.state.kind);
	const [now, setNow] = createSignal(props.now);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	const [answers, setAnswers] = createSignal<Record<string, AnswerPayload>>({
		...props.answers,
	});
	const [saveErrors, setSaveErrors] = createSignal<Record<string, string>>({});
	// Questions with a change not yet confirmed by the server.
	const [unsaved, setUnsaved] = createSignal<ReadonlySet<string>>(new Set());
	let dialog: HTMLDialogElement | undefined;

	const opensAt = () =>
		props.state.kind === "not-open" ? props.state.opensAt : null;
	const deadline = () =>
		props.state.kind === "in-progress" ? props.state.deadline : null;

	// Answers waiting to be sent, and the timers that will send them.
	const pending = new Map<string, AnswerPayload>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	// Saves run one after another so an older answer never lands after a newer one.
	let queue: Promise<void> = Promise.resolve();

	function setSaveError(slug: string, message: string | null): void {
		setSaveErrors((current) => {
			const { [slug]: _dropped, ...rest } = current;
			return message === null ? rest : { ...rest, [slug]: message };
		});
	}

	function markUnsaved(slug: string, value: boolean): void {
		setUnsaved((current) => {
			const next = new Set(current);
			if (value) next.add(slug);
			else next.delete(slug);
			return next;
		});
	}

	function saveNow(slug: string): void {
		const timer = timers.get(slug);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(slug);

		const payload = pending.get(slug);
		if (payload === undefined) return;
		pending.delete(slug);

		queue = queue.then(async () => {
			// A dropped connection throws rather than returning an error; catching
			// it keeps the queue alive for the saves that follow.
			const message = await actions.exam
				.answer({ ...target, question: slug, payload })
				.then(
					({ error }) => (error ? errorMessage(error) : null),
					() => m.exams_attempt_connection_failed(),
				);
			if (message === null) {
				setSaveError(slug, null);
				if (!pending.has(slug)) markUnsaved(slug, false);
				return;
			}

			// A newer answer typed meanwhile supersedes the failed one.
			if (!pending.has(slug)) pending.set(slug, payload);
			setSaveError(slug, message);
		});
	}

	/// Sends everything still pending; resolves to whether every answer is saved.
	async function flush(): Promise<boolean> {
		for (const slug of [...pending.keys()]) saveNow(slug);
		await queue;
		return pending.size === 0;
	}

	function change(slug: string, type: string, payload: AnswerPayload): void {
		setAnswers((current) => ({ ...current, [slug]: payload }));
		pending.set(slug, payload);
		markUnsaved(slug, true);
		if (!isTextEntry(type)) {
			saveNow(slug);
			return;
		}

		const timer = timers.get(slug);
		if (timer !== undefined) clearTimeout(timer);
		timers.set(
			slug,
			setTimeout(() => saveNow(slug), SAVE_DELAY_MS),
		);
	}

	async function start(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.exam.start(target);
		if (error) {
			setFailure(errorMessage(error));
			setBusy(false);
			return;
		}
		window.location.reload();
	}

	async function submit(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const saved = await flush();
		if (!saved) {
			setFailure(m.exams_attempt_save_failed());
		} else {
			const { error } = await actions.exam.finish(target);
			if (error) setFailure(errorMessage(error));
			// The server decides what follows: awaiting grading, or the results.
			else window.location.reload();
		}
		dialog?.close();
		setBusy(false);
	}

	onMount(() => {
		const interval = setInterval(() => setNow(serverNow()), 1000);
		onCleanup(() => clearInterval(interval));
	});
	onCleanup(() => {
		for (const timer of timers.values()) clearTimeout(timer);
	});

	// Once the deadline passes the server refuses further answers: save what
	// is pending and show the attempt as submitted.
	createEffect(() => {
		const limit = deadline();
		if (kind() !== "in-progress" || !limit || now() <= limit) return;
		void flush().then(() => setKind("submitted"));
	});

	return (
		<div class="flex flex-col gap-6">
			<FormAlert error={failure() ?? undefined} />

			<Switch>
				<Match when={kind() === "not-open"}>
					<p role="status" class={NOTICE}>
						<Show when={opensAt()} fallback={m.exams_attempt_not_open_yet()}>
							{(date) => (
								<>
									<time
										datetime={date().toISOString()}
										title={formatDateTime(date(), { year: "numeric" })}
									>
										{m.exams_attempt_opens({
											when: formatRelative(date(), now()),
										})}
									</time>
								</>
							)}
						</Show>
					</p>
				</Match>

				<Match when={kind() === "can-start"}>
					<div>
						<button
							type="button"
							class="btn btn-primary"
							disabled={busy()}
							onClick={start}
						>
							{m.exams_attempt_start({ type: props.type })}
						</button>
					</div>
				</Match>

				<Match when={kind() === "missed"}>
					<p role="status" class={NOTICE}>
						{m.exams_attempt_missed({ type: props.type })}
					</p>
				</Match>

				<Match
					when={
						kind() === "in-progress" ||
						kind() === "submitted" ||
						kind() === "results"
					}
				>
					{/* Once the results are out, the score above says it all. */}
					<Show
						when={kind() === "in-progress"}
						fallback={
							<Show when={kind() === "submitted"}>
								<p role="status" class={NOTICE}>
									{m.exams_attempt_submitted_waiting()}
								</p>
							</Show>
						}
					>
						<AttemptBar
							type={props.type}
							seconds={(() => {
								const limit = deadline();
								return limit ? secondsLeft(limit, now()) : null;
							})()}
							questions={props.questions.map((entry, index) => ({
								number: index + 1,
								answered: isAnswered(answers()[entry.slug]),
								failed: saveErrors()[entry.slug] !== undefined,
							}))}
							saving={unsaved().size > 0}
							busy={busy()}
							onSubmit={() => dialog?.showModal()}
						/>
					</Show>

					<For each={props.questions}>
						{(entry, index) => (
							<div
								id={`question-${index() + 1}`}
								class={`card card-border overflow-hidden bg-base-100/50 ${QUESTION_SCROLL_MARGIN}`}
							>
								{/* focusout bubbles, so leaving any control of the question saves it. */}
								<div class="card-body" onFocusOut={() => saveNow(entry.slug)}>
									<div class="flex items-baseline justify-between gap-3">
										<span class="kicker">
											{m.exams_attempt_question_of({
												number: index() + 1,
												total: props.questions.length,
											})}
										</span>
										<Show when={kind() === "in-progress"}>
											<SaveState
												failed={saveErrors()[entry.slug] !== undefined}
												saving={unsaved().has(entry.slug)}
												answered={isAnswered(answers()[entry.slug])}
											/>
										</Show>
									</div>
									<AnswerField
										question={entry.question}
										payload={answers()[entry.slug]}
										readonly={kind() !== "in-progress"}
										onChange={(payload) =>
											change(entry.slug, entry.question.type, payload)
										}
									/>
									<Show when={kind() === "results" && props.result}>
										{(result) => (
											<Outcome
												outcome={result().questions.find(
													(outcome) => outcome.question === entry.slug,
												)}
												regrade={props.regrades?.[entry.slug]}
												target={target}
											/>
										)}
									</Show>
									<Show when={saveErrors()[entry.slug]}>
										{(message) => (
											<p role="alert" class="text-sm text-error">
												{m.exams_attempt_save_error({ message: message() })}
											</p>
										)}
									</Show>
								</div>
							</div>
						)}
					</For>

					<dialog ref={dialog} class="modal">
						<div class="modal-box">
							<h3 class="text-lg font-bold">
								{m.exams_attempt_submit_title({ type: props.type })}
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								{m.exams_attempt_submit_body()}
							</p>
							<div class="modal-action">
								<button
									type="button"
									class="btn btn-ghost"
									disabled={busy()}
									onClick={() => dialog?.close()}
								>
									{m.exams_cancel()}
								</button>
								<button
									type="button"
									class="btn btn-primary"
									disabled={busy()}
									onClick={submit}
								>
									{m.exams_attempt_submit({ type: props.type })}
								</button>
							</div>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">{m.exams_close_backdrop()}</button>
						</form>
					</dialog>
				</Match>
			</Switch>
		</div>
	);
}

interface AttemptBarProps {
	type: Exam["type"];
	/// Seconds until the deadline, or `null` when the attempt has none.
	seconds: number | null;
	questions: { number: number; answered: boolean; failed: boolean }[];
	/// Whether some change still waits for the server.
	saving: boolean;
	busy: boolean;
	onSubmit: () => void;
}

/// The bar that stays in view while answering: time, progress, saving, submit, and a way to each question.
function AttemptBar(props: AttemptBarProps): JSX.Element {
	const answered = () => props.questions.filter((q) => q.answered).length;
	const failed = () => props.questions.filter((q) => q.failed).length;

	const saveStatus = () => (
		<Switch>
			<Match when={failed() > 0}>
				<span class="text-error">
					{m.exams_attempt_answers_not_saved({ count: failed() })}
				</span>
			</Match>
			<Match when={props.saving}>
				<span class="text-base-content/60">{m.exams_attempt_saving()}</span>
			</Match>
			<Match when={answered() > 0}>
				<span class="text-base-content/60">{m.exams_attempt_all_saved()}</span>
			</Match>
		</Switch>
	);

	return (
		<div class="sticky top-16 z-20 -mx-4 border-b border-base-300 bg-base-100 px-4 py-3">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
					<Show
						when={props.seconds !== null}
						fallback={
							<span class="font-semibold">
								{m.exams_attempt_no_time_limit()}
							</span>
						}
					>
						<span
							class={`font-semibold tabular-nums ${timeClass(props.seconds ?? 0)}`}
						>
							{timeLeft(props.seconds ?? 0)}
						</span>
					</Show>
					<span class="text-base-content/60">
						{m.exams_attempt_progress({
							answered: answered(),
							total: props.questions.length,
						})}
					</span>
					<span class="hidden sm:inline">{saveStatus()}</span>
				</div>
				<button
					type="button"
					class="btn btn-primary btn-sm shrink-0"
					disabled={props.busy}
					onClick={props.onSubmit}
				>
					{m.exams_attempt_submit({ type: props.type })}
				</button>
			</div>
			<nav
				aria-label={m.exams_attempt_nav_label()}
				class="mt-2 flex flex-wrap gap-1.5"
			>
				<For each={props.questions}>
					{(question) => (
						<a
							href={`#question-${question.number}`}
							aria-label={
								question.answered
									? m.exams_attempt_question_answered({
											number: question.number,
										})
									: m.exams_attempt_question_label({ number: question.number })
							}
							class={`btn btn-xs btn-square ${
								question.failed
									? "btn-error"
									: question.answered
										? "btn-primary"
										: "btn-outline"
							}`}
						>
							{question.number}
						</a>
					)}
				</For>
			</nav>
			<p class="mt-1 text-xs sm:hidden">{saveStatus()}</p>
		</div>
	);
}

/// One question's save state while answering; nothing until it has an answer.
function SaveState(props: {
	failed: boolean;
	saving: boolean;
	answered: boolean;
}): JSX.Element {
	return (
		<Switch>
			<Match when={props.failed}>
				<span class="text-xs text-error">{m.exams_attempt_not_saved()}</span>
			</Match>
			<Match when={props.saving}>
				<span class="text-xs text-base-content/50">
					{m.exams_attempt_saving()}
				</span>
			</Match>
			<Match when={props.answered}>
				<span class="text-xs text-base-content/50">
					{m.exams_attempt_saved()}
				</span>
			</Match>
		</Switch>
	);
}

/// The verdict on one question: its score or why it has none, and the comments.
function Outcome(props: {
	outcome: QuestionOutcome | undefined;
	regrade: QuestionRegrade | undefined;
	target: { discipline: string; course: string; exam: string };
}): JSX.Element {
	return (
		<Show when={props.outcome}>
			{(outcome) => (
				<div class="mt-2 border-t border-base-300 pt-3">
					<p class="font-semibold">
						<Switch>
							<Match when={outcome().status === "graded"}>
								<span class="font-normal text-base-content/60">
									{m.exams_attempt_score_label()}
								</span>{" "}
								{formatScore(outcome().score ?? 0)}
							</Match>
							<Match when={outcome().status === "pending"}>
								{m.exams_attempt_waiting()}
							</Match>
							<Match when={outcome().status === "unanswered"}>
								{m.exams_attempt_not_answered()}
							</Match>
							<Match when={outcome().status === "not-graded"}>
								{m.exams_attempt_not_graded()}
							</Match>
						</Switch>
					</p>
					<For each={outcome().comments}>
						{(comment) => (
							<p class="mt-1 whitespace-pre-wrap text-sm text-base-content/70">
								{comment}
							</p>
						)}
					</For>
					<Show
						when={
							props.regrade &&
							(props.regrade.canRequest || props.regrade.request)
						}
					>
						<RegradeControls
							{...props.target}
							regrade={props.regrade as QuestionRegrade}
						/>
					</Show>
				</div>
			)}
		</Show>
	);
}

interface AnswerFieldProps {
	question: QuestionPublic["question"];
	payload: AnswerPayload | undefined;
	readonly: boolean;
	onChange: (payload: AnswerPayload) => void;
}

/// One question in answer mode, or frozen on the student's saved answer.
function AnswerField(props: AnswerFieldProps): JSX.Element {
	const mode = () => (props.readonly ? "readonly" : "answer");
	return (
		<Switch
			fallback={
				<p class="text-sm text-base-content/60">
					{m.exams_attempt_unsupported({ type: props.question.type })}
				</p>
			}
		>
			<Match when={props.question.type === "multiple-choice"}>
				<MultipleChoiceView
					question={props.question as PublicMultipleChoice}
					value={choiceOf(props.payload)}
					onChange={(choice) => props.onChange({ choice })}
					mode={mode()}
				/>
			</Match>
			<Match when={props.question.type === "multiple-selection"}>
				<MultipleSelectionView
					question={props.question as PublicMultipleSelection}
					value={choicesOf(props.payload)}
					onChange={(choices) => props.onChange(fromChoices(choices))}
					mode={mode()}
				/>
			</Match>
			<Match when={props.question.type === "true-false"}>
				<TrueFalseView
					question={props.question as PublicTrueFalse}
					value={answersOf(props.payload)}
					onChange={(answers) => props.onChange(fromAnswers(answers))}
					mode={mode()}
				/>
			</Match>
			<Match when={props.question.type === "numeric"}>
				<NumericView
					question={props.question as PublicNumeric}
					value={numberOf(props.payload)}
					onChange={(value) => props.onChange({ value })}
					mode={mode()}
				/>
			</Match>
			<Match when={props.question.type === "short-answer"}>
				<ShortAnswerView
					question={props.question as PublicShortAnswer}
					value={textOf(props.payload)}
					onChange={(text) => props.onChange({ text })}
					mode={mode()}
				/>
			</Match>
			<Match when={props.question.type === "essay"}>
				<EssayView
					question={props.question as PublicEssay}
					value={essayOf(props.payload)}
					onChange={(essay) => props.onChange({ essay })}
					mode={mode()}
				/>
			</Match>
			<Match when={props.question.type === "fill-in"}>
				<FillInView
					question={props.question as PublicFillIn}
					value={blanksOf(props.payload)}
					onChange={(blanks) => props.onChange({ blanks })}
					mode={mode()}
				/>
			</Match>
		</Switch>
	);
}
