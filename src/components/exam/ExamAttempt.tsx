import { actions } from "astro:actions";
import type { LanguageId } from "@codehood/runner/protocol";
import {
	createEffect,
	createSignal,
	For,
	Index,
	type JSX,
	Match,
	onCleanup,
	onMount,
	Show,
	Switch,
} from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import AppliedItems from "@/components/grading/AppliedItems";
import { AnyQuestionView, mdqMessages } from "@/components/question/mdq";
import type { Exam, QuestionPublic } from "@/db";
import { errorMessage } from "@/forms/field-errors";
import { locale, m } from "@/i18n";
import { runnerLanguage } from "@/runner/languages";
import type { AnswerEditAdapter } from "@/services/answer-edits/adapter";
import {
	kindOfInputType,
	kindOfUserEvent,
} from "@/services/answer-edits/input-kind";
import {
	type ExamResult,
	formatScore,
	type QuestionOutcome,
} from "@/services/exam-result";
import type { AttemptState } from "@/services/exam-state";
import type { ReviewResult } from "@/services/review";
import type { PretestSource } from "@/utils/pretest-sources";
import { formatRelative } from "@/utils/relative-time";
import { formatDateTime } from "@/utils/schedule-time";
import {
	type AnswerPayload,
	isAnswered,
	isTextEntry,
	toSaved,
} from "./answer-payload";
import { CodeAnswer } from "./CodeAnswer";
import { CodeEssayAnswer, type CodeEssayAnswerProps } from "./CodeEssayAnswer";
import {
	browserDraftStore,
	compareDraft,
	measureClockOffset,
} from "./code-draft";
import { type CodeSends, hasPendingSend, sendsOf } from "./code-sends";
import RegradeControls, { type QuestionRegrade } from "./RegradeControls";
import { retryDelay } from "./save-retry";
import { questionList, unansweredWarning } from "./unanswered-warning";

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
	/// The marks and feedback of each answered question, by question slug, once the grades are released.
	reviews?: Record<string, ReviewResult>;
	/// What the student may do about the regrade of each question's answer, by question slug.
	regrades?: Record<string, QuestionRegrade>;
	/// Whether students may run code in this exam (`canRunCode`).
	codeRun?: boolean;
	/// Origin of the runner iframe; null when the server has none.
	runnerOrigin?: string | null;
	/// The sources the browser runs as pretests of each code question, by question slug.
	pretests?: Record<string, PretestSource[]>;
	/// The highlighted HTML of each code question's example tests, by question slug.
	exampleHtml?: Record<string, string[]>;
	/// The sends of each code question that goes to a worker, by question slug; a question without an entry has no submit button.
	codeSends?: Record<string, CodeSends>;
	/// The viewing student, which keys their local code drafts.
	username?: string;
	/// When the server saved each answer, by question slug (ISO), for the draft conflict panel.
	answeredAt?: Record<string, string>;
	/// How long after the deadline the server still accepts an answer, which the last resend uses.
	graceMs?: number;
	/// The attempt's `publicId`, which keys its local edit history and names it to the history actions.
	attempt?: string;
	/// Whether the exam's edit-history switch is on, as the server computed it.
	answerHistory?: boolean;
}

/// The box every state sentence of an attempt sits in.
const NOTICE = "rounded-box border border-info bg-info/5 p-4 text-sm";

/// How long a save may take before it shows as "Saving…".
const SLOW_SAVE_MS = 400;

/// How long before the deadline a newer local draft is saved for the student.
const DRAFT_SAVE_LEAD_SECONDS = 10;

/// How long the page waits between two reads of the sends that still wait for a worker.
const SENDS_POLL_MS = 5000;

/// How long typing pauses before a text answer is saved.
const SAVE_DELAY_MS = 500;

/// How long a save may stay unanswered before it counts as a failed connection.
const SAVE_TIMEOUT_MS = 15_000;

/// The shortest time between two prompt retries triggered by the student coming back to a tab whose session ended.
const SESSION_KICK_MIN_MS = 5000;

/// How long the page waits for the history's last flush after a finished attempt, whatever the monitor does.
const HISTORY_FINAL_WAIT_MS = 2000;

/// Rejects when `promise` has not settled after `ms`.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout")), ms);
		promise.then(resolve, reject).finally(() => clearTimeout(timer));
	});
}

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

	// `serverNow - clientNow`. The first value includes the page's load time;
	// each confirmed save replaces it with a measure taken around the request.
	const [skew, setSkew] = createSignal(props.now.getTime() - Date.now());
	const serverNow = () => new Date(Date.now() + skew());

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
	// Questions the server has confirmed an answer for, the loaded ones included.
	const [confirmed, setConfirmed] = createSignal<ReadonlySet<string>>(
		new Set(Object.keys(props.answers)),
	);
	// When the server last confirmed a save of each question, and since when its saves fail.
	const [savedAt, setSavedAt] = createSignal<Record<string, Date>>({});
	const [failingSince, setFailingSince] = createSignal<Record<string, Date>>(
		{},
	);
	// Code questions whose local draft and saved answer still disagree.
	const [conflicts, setConflicts] = createSignal<
		Record<string, { newer: "draft" | "server"; draftCode: string }>
	>({});
	let dialog: HTMLDialogElement | undefined;

	// An ordering question shows its lines before the student touches them, so
	// leaving it unanswered is easy to miss: the submit dialog names them.
	const unsortedNumbers = () =>
		props.questions.flatMap((entry, index) =>
			entry.question.type === "ordering" &&
			!isAnswered(entry.question.type, answers()[entry.slug])
				? [index + 1]
				: [],
		);

	/// The numbers of every question still unanswered, which the submit dialog warns about.
	const unansweredNumbers = () =>
		props.questions.flatMap((entry, index) =>
			isAnswered(entry.question.type, answers()[entry.slug]) ? [] : [index + 1],
		);

	/// The numbers of the code questions whose local draft and saved answer disagree.
	const conflictNumbers = () =>
		props.questions.flatMap((entry, index) =>
			conflicts()[entry.slug] ? [index + 1] : [],
		);

	/// Whether some question runs code in the browser, which the attempt bar says.
	const runsCode = () =>
		(props.codeRun ?? false) &&
		props.questions.some((entry) => codeLanguageOf(entry.question) !== null);

	// Weights show only when some question weighs other than the default 1.
	const weighted = () =>
		props.questions.some((entry) => weightOf(entry.question) !== 1);
	const totalWeight = () =>
		props.questions.reduce((sum, entry) => sum + weightOf(entry.question), 0);
	/// The part of the exam total a question carries, in [0, 1].
	const shareOf = (question: QuestionPublic["question"]) =>
		totalWeight() > 0 ? weightOf(question) / totalWeight() : 0;

	/// The mean weight of the questions still unanswered, which the water levels compare against.
	const remainingMean = () => {
		const weights = props.questions
			.filter(
				(entry) => !isAnswered(entry.question.type, answers()[entry.slug]),
			)
			.map((entry) => weightOf(entry.question));
		return weights.length === 0
			? 0
			: weights.reduce((sum, weight) => sum + weight, 0) / weights.length;
	};

	// The question whose card crosses the line under the attempt bar.
	const [current, setCurrent] = createSignal<number | null>(null);
	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					setCurrent(Number(entry.target.id.replace("question-", "")));
				}
			},
			{ rootMargin: "-224px 0px -60% 0px" },
		);
		for (const element of document.querySelectorAll("[id^='question-']")) {
			observer.observe(element);
		}
		onCleanup(() => observer.disconnect());
	});

	const opensAt = () =>
		props.state.kind === "not-open" ? props.state.opensAt : null;
	const deadline = () =>
		props.state.kind === "in-progress" ? props.state.deadline : null;

	// Answers waiting to be sent, and the timers that will send them.
	const pending = new Map<string, AnswerPayload>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	// Saves run one after another so an older answer never lands after a newer one.
	let queue: Promise<void> = Promise.resolve();
	// The number of the latest save sent for each question: a failed older save
	// is not retried once a newer one exists.
	const dispatched = new Map<string, number>();
	let sends = 0;
	// Failed saves in a row, which sets the wait before the next retry.
	let failures = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	// Set once the deadline passed: answers are locked while the last send is retried.
	const [closing, setClosing] = createSignal(false);
	// The question numbers whose answers never reached the server at the deadline.
	const [undelivered, setUndelivered] = createSignal<number[]>([]);
	/// Set while the server refuses saves because the session ended; cleared by the next save that succeeds.
	const [sessionLost, setSessionLost] = createSignal(false);
	const [copied, setCopied] = createSignal(false);

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
		const send = ++sends;
		dispatched.set(slug, send);

		queue = queue.then(async () => {
			// A dropped or hung connection throws rather than returning an error;
			// catching it keeps the queue alive for the saves that follow.
			const sentAt = Date.now();
			const request = actions.exam.answer({
				...target,
				question: slug,
				payload,
			});
			let gaveUp = false;
			// A request given up on may still reach the server, after newer ones.
			request.then(
				({ error }) => {
					if (gaveUp && !error) landedLate(slug, payload);
				},
				() => {},
			);
			const outcome = await withTimeout(request, SAVE_TIMEOUT_MS).then(
				({ data, error }) => {
					if (data) {
						setSkew(measureClockOffset(data.serverNow, sentAt, Date.now()));
						if (data.answerHistory === false) switchHistoryOff();
					}
					return {
						message: error ? errorMessage(error) : null,
						unauthorized: error?.code === "UNAUTHORIZED",
					};
				},
				() => {
					gaveUp = true;
					return {
						message: m.exams_attempt_connection_failed(),
						unauthorized: false,
					};
				},
			);
			const { message } = outcome;
			if (message === null) {
				failures = 0;
				setSessionLost(false);
				setSaveError(slug, null);
				setSavedAt((current) => ({ ...current, [slug]: serverNow() }));
				setFailingSince(({ [slug]: _ok, ...rest }) => rest);
				setConfirmed((current) => new Set(current).add(slug));
				settleDraft(slug, payload);
				if (!pending.has(slug)) markUnsaved(slug, false);
				return;
			}

			// A newer answer, typed or already sent, supersedes the failed one.
			if (!pending.has(slug) && dispatched.get(slug) === send) {
				pending.set(slug, payload);
			}
			if (outcome.unauthorized) setSessionLost(true);
			setSaveError(slug, message);
			setFailingSince((current) => ({
				...current,
				[slug]: current[slug] ?? serverNow(),
			}));
			failures++;
			scheduleRetry();
		});
	}

	/// Sends everything still pending; resolves to whether every answer is saved.
	async function flush(): Promise<boolean> {
		for (const slug of [...pending.keys()]) saveNow(slug);
		await queue;
		return pending.size === 0;
	}

	/// Sends what is pending, and again every second while the server may still accept it after `limit`; resolves to whether every answer is saved.
	async function flushUntilGraceEnds(limit: Date): Promise<boolean> {
		const lastChance = limit.getTime() + (props.graceMs ?? 0);
		let saved = await flush();
		while (!saved && serverNow().getTime() < lastChance) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			saved = await flush();
		}
		return saved;
	}

	/// Sends the question's current answer again when an abandoned request carrying a different one lands, since the server keeps the last to arrive.
	function landedLate(slug: string, payload: AnswerPayload): void {
		const current = answers()[slug] ?? null;
		if (JSON.stringify(current) === JSON.stringify(payload)) return;
		pending.set(slug, current);
		markUnsaved(slug, true);
		void flush().then((saved) => {
			if (!saved && kind() === "submitted") setUndelivered(unsavedNumbers());
		});
	}

	/// Sends what is still pending after a wait that grows with each failure in a row.
	function scheduleRetry(): void {
		if (retryTimer !== undefined || pending.size === 0) return;
		retryTimer = setTimeout(() => {
			retryTimer = undefined;
			if (kind() === "in-progress") void flush();
		}, retryDelay(failures));
	}

	/// The sends of each code question as the page counts them, after the ones this page made.
	const [sendsNow, setSendsNow] = createSignal<Record<string, CodeSends>>({});

	/// The sends of every code question that goes to a worker, as the server last told this page.
	const allSends = (): Record<string, CodeSends> => ({
		...props.codeSends,
		...sendsNow(),
	});

	/// Saves the pending answers, then sends the code of `slug` to its worker; throws the reason it was refused.
	async function submitCode(slug: string, code: string): Promise<void> {
		if (!(await flush())) throw new Error(m.exams_attempt_connection_failed());
		const { data, error } = await actions.exam.answer({
			...target,
			question: slug,
			payload: code,
			kind: "SUBMIT",
		});
		if (error) throw new Error(errorMessage(error));
		if (data.sends) {
			const sends = sendsOf(data.sends);
			setSendsNow((current) => ({ ...current, [slug]: sends }));
		} else {
			await refreshSends([slug]);
		}
	}

	/// Asks the server for the sends of `slugs` again, ignoring a question it cannot read.
	async function refreshSends(slugs: string[]): Promise<void> {
		if (!props.attempt) return;
		const attempt = props.attempt;
		await Promise.all(
			slugs.map(async (slug) => {
				const { data } = await actions.gradingJob.forStudent({
					response: attempt,
					question: slug,
				});
				if (data) {
					setSendsNow((current) => ({ ...current, [slug]: sendsOf(data) }));
				}
			}),
		);
	}

	/// While a send waits for its worker, asks for the sends every few seconds; it stops when none is pending or the page goes away.
	createEffect(() => {
		const waiting = Object.entries(allSends())
			.filter(([, sends]) => hasPendingSend(sends))
			.map(([slug]) => slug);
		if (waiting.length === 0 || kind() !== "in-progress") return;
		const timer = setInterval(() => void refreshSends(waiting), SENDS_POLL_MS);
		onCleanup(() => clearInterval(timer));
	});

	/// Sends what is pending now, instead of waiting out the retry delay.
	function retryNow(): void {
		if (retryTimer !== undefined) clearTimeout(retryTimer);
		retryTimer = undefined;
		failures = 0;
		if (kind() === "in-progress") void flush();
	}

	/// When the last prompt retry for a lost session ran, which keeps a tab flipping back and forth from retrying in a storm.
	let lastSessionKick = 0;

	/// Retries the pending saves now when the session is lost and the student returns to this tab, at most once every few seconds.
	function kickSessionRetry(): void {
		if (document.visibilityState === "hidden" || !sessionLost()) return;
		if (Date.now() - lastSessionKick < SESSION_KICK_MIN_MS) return;
		lastSessionKick = Date.now();
		if (retryTimer !== undefined) clearTimeout(retryTimer);
		retryTimer = undefined;
		if (kind() === "in-progress") void flush();
	}

	/// The edit history of typed answers, set once its code has loaded; null while the switch is off, loading or failed.
	let history: AnswerEditAdapter | null = null;
	let historyStopped = false;

	/// The questions whose typed answer the history follows: essays, which include code essays.
	const historyQuestions = () =>
		props.questions.filter((entry) => entry.question.type === "essay");

	/// Runs `action` on the history adapter, swallowing any failure: the history may lose edits, never hold up an answer.
	function withHistory(action: (adapter: AnswerEditAdapter) => void): void {
		const adapter = history;
		if (!adapter) return;
		try {
			action(adapter);
		} catch {
			history = null;
		}
	}

	/// The `inputType` a textarea announced just before its answer changed, per question; gone once used or once the event has run its course.
	const announcedInputs = new Map<string, { inputType: string }>();

	/// Remembers what a textarea of `slug` is about to do, so the change that follows is recorded with its cause; never throws.
	function announceInput(slug: string, event: InputEvent): void {
		if (!history) return;
		try {
			if (!(event.target instanceof HTMLTextAreaElement)) return;
			const announced = { inputType: event.inputType };
			announcedInputs.set(slug, announced);
			// `beforeinput` and the `input` that follows run in the same task.
			setTimeout(() => {
				if (announcedInputs.get(slug) === announced)
					announcedInputs.delete(slug);
			}, 0);
		} catch {
			// The cause stays unknown, which the history records as `other`.
		}
	}

	/// Tells the history the editor of `slug` now holds `edited`, with the CodeMirror `userEvent` when the editor gave one.
	function recordEdit(
		slug: string,
		type: string,
		edited: AnswerPayload,
		userEvent?: string,
	): void {
		const announced = announcedInputs.get(slug);
		announcedInputs.delete(slug);
		if (!history || type !== "essay") return;
		const text = edited ?? "";
		if (typeof text !== "string") return;
		withHistory((adapter) =>
			adapter.input(
				{ questionId: slug, field: "answer" },
				text,
				userEvent !== undefined
					? kindOfUserEvent(userEvent)
					: kindOfInputType(announced?.inputType),
			),
		);
	}

	/// Loads the history monitor in the background when the exam's switch is on; every failure leaves the page as it is without it.
	function startHistory(): void {
		if (!props.username || !props.attempt || !props.answerHistory) return;
		const ownerId = props.username;
		const attemptId = props.attempt;
		const exam = {
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
		};
		try {
			import("./answer-edit-session")
				.then((session) =>
					session.openAnswerEditSession({
						ownerId,
						attemptId,
						transport: session.createActionTransport({
							actions: actions.answerHistory,
							exam,
							onDisabled: switchHistoryOff,
						}),
					}),
				)
				.then((adapter) => {
					if (historyStopped) {
						adapter.disable("page closed");
						return;
					}
					history = adapter;
					for (const entry of historyQuestions()) {
						const text = answers()[entry.slug];
						withHistory((it) =>
							it.attach(
								{ questionId: entry.slug, field: "answer" },
								typeof text === "string" ? text : "",
							),
						);
					}
				})
				.catch(() => {});
		} catch {
			// A browser without dynamic imports simply has no history.
		}
	}

	/// Stops the history for good, as the server says the exam's switch is off; never throws.
	function switchHistoryOff(): void {
		withHistory((adapter) => adapter.disable("exam switch off"));
	}

	/// Removes the local records of an attempt that is no longer in progress, in the background; never throws.
	function removeSettledHistory(): void {
		if (!props.username || !props.attempt || !props.answerHistory) return;
		const ownerId = props.username;
		const attemptId = props.attempt;
		const questionIds = [
			...new Set([
				...historyQuestions().map((entry) => entry.slug),
				...Object.keys(props.answers),
			]),
		];
		try {
			import("./answer-edit-session")
				.then((session) =>
					session.removeAnswerEditRecords({ ownerId, attemptId, questionIds }),
				)
				.catch(() => {});
		} catch {
			// The records expire on their own.
		}
	}

	/// Sends the history's pending work without waiting for it, as the page is being hidden or closed.
	function flushHistoryNow(): void {
		withHistory((adapter) => void adapter.flushFinal());
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === "hidden") flushHistoryNow();
		else kickSessionRetry();
	}

	/// Waits for the history's last flush, then erases its local copy, all within one bound; never fails.
	async function settleHistory(flushed: Promise<void>): Promise<void> {
		try {
			await withTimeout(
				(async () => {
					await flushed;
					await history?.discard();
				})(),
				HISTORY_FINAL_WAIT_MS,
			);
		} catch {
			// The history is best effort, and its records expire on their own.
		}
	}

	/// Waits for the history's last flush, never longer than the page's own bound, and never fails.
	async function flushHistoryFinal(): Promise<void> {
		try {
			// The page keeps its own bound: it never trusts the monitor to settle.
			await withTimeout(
				Promise.resolve(history?.flushFinal()),
				HISTORY_FINAL_WAIT_MS,
			);
		} catch {
			// The history is best effort.
		}
	}

	function change(
		slug: string,
		type: string,
		edited: AnswerPayload,
		userEvent?: string,
	): void {
		if (closing()) return;
		queueAnswer(slug, type, edited);
		// Only after the answer and its draft are queued, and it cannot throw.
		recordEdit(slug, type, edited, userEvent);
	}

	/// Queues the answer to be saved and keeps its draft; the edit history never takes part in it.
	function queueAnswer(
		slug: string,
		type: string,
		edited: AnswerPayload,
	): void {
		const payload = toSaved(type, edited);
		setAnswers((current) => ({ ...current, [slug]: payload }));
		pending.set(slug, payload);
		markUnsaved(slug, true);
		// The draft is a courtesy: queuing the answer never waits on it.
		keepDraft(slug, type, edited);
		if (payload === null || !isTextEntry(type)) {
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

	/// The text each question's draft was last written with, so a confirmed save removes only the draft this page wrote.
	const draftWrites = new Map<string, string>();

	/// Whether a typed answer to `slug` has its draft kept by this component; code answers keep their own in `CodeEssayAnswer`.
	function keepsOwnDraft(slug: string, type: string): boolean {
		const entry = props.questions.find((it) => it.slug === slug);
		return (
			!!props.username &&
			isTextEntry(type) &&
			!(entry && codeLanguageOf(entry.question) !== null)
		);
	}

	/// Writes the local draft of a typed answer, so a reload or a crash before the server confirms it loses nothing.
	function keepDraft(slug: string, type: string, edited: AnswerPayload): void {
		if (typeof edited !== "string" || !keepsOwnDraft(slug, type)) return;
		draftWrites.set(slug, edited);
		browserDraftStore().write(draftRef(slug), {
			code: edited,
			savedAt: serverNow().getTime(),
		});
	}

	/// Removes the draft of `slug` once the server confirmed `payload`, if that is still the answer and the draft is this page's last write.
	function settleDraft(slug: string, payload: AnswerPayload): void {
		const written = draftWrites.get(slug);
		if (written === undefined) return;
		if (JSON.stringify(answers()[slug] ?? null) !== JSON.stringify(payload)) {
			return;
		}
		const store = browserDraftStore();
		const ref = draftRef(slug);
		if (store.read(ref, serverNow().getTime())?.code === written) {
			store.remove(ref);
		}
		draftWrites.delete(slug);
	}

	/// Restores the typed answers whose draft is newer than the saved answer, and drops the drafts the server already holds.
	function restoreDrafts(): void {
		if (!props.username) return;
		const store = browserDraftStore();
		for (const entry of props.questions) {
			const type = entry.question.type;
			if (!keepsOwnDraft(entry.slug, type)) continue;
			const ref = draftRef(entry.slug);
			const draft = store.read(ref, serverNow().getTime());
			const saved = props.answers[entry.slug];
			const at = props.answeredAt?.[entry.slug];
			const found = compareDraft(
				draft,
				typeof saved === "string" ? saved : saved == null ? "" : String(saved),
				at ? new Date(at).getTime() : null,
			);
			if (found.kind === "same") store.remove(ref);
			else if (found.kind === "conflict" && found.newer === "draft" && draft) {
				change(entry.slug, type, draft.code);
			}
		}
	}

	/// The key of a typed answer's local draft.
	const draftRef = (question: string) => ({
		username: props.username ?? "",
		course: `${props.discipline}/${props.course}`,
		exam: props.exam,
		question,
	});

	/// Removes this exam's local drafts, once the attempt is over.
	function clearDrafts(): void {
		if (!props.username) return;
		const { question: _question, ...exam } = draftRef("");
		browserDraftStore().clearExam(exam);
	}

	/// Removes the local drafts that match the saved answer, and keeps those that differ, which may be the only copy.
	function clearSettledDrafts(): void {
		if (!props.username) return;
		const store = browserDraftStore();
		for (const entry of props.questions) {
			const ref = draftRef(entry.slug);
			const draft = store.read(ref, serverNow().getTime());
			const saved = props.answers[entry.slug];
			const at = props.answeredAt?.[entry.slug];
			const found = compareDraft(
				draft,
				typeof saved === "string" ? saved : "",
				at ? new Date(at).getTime() : null,
			);
			if (found.kind === "same") store.remove(ref);
		}
	}

	/// The numbers of the questions with a change the server has not confirmed.
	const unsavedNumbers = () =>
		props.questions.flatMap((entry, index) =>
			unsaved().has(entry.slug) ? [index + 1] : [],
		);

	/// Puts the unsent answers on the clipboard as plain text, a question label above each answer.
	async function copyUnsent(): Promise<void> {
		const text = props.questions
			.flatMap((entry, index) => {
				if (!unsaved().has(entry.slug)) return [];
				const answer = answers()[entry.slug];
				const body =
					typeof answer === "string" ? answer : JSON.stringify(answer ?? "");
				return [
					`${m.exams_attempt_question_label({ number: index + 1 })}\n${body}`,
				];
			})
			.join("\n\n");
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	/// Saves the draft of every code question whose draft is newer than its saved answer.
	function keepNewerDrafts(): void {
		if (Object.keys(conflicts()).length === 0) return;
		for (const [slug, found] of Object.entries(conflicts())) {
			if (found.newer === "draft") change(slug, "essay", found.draftCode);
		}
		setConflicts({});
	}

	/// What `AnswerField` needs to show `question` as a code answer, or undefined when it is not one.
	function codeContext(
		slug: string,
		question: QuestionPublic["question"],
		status: { failed: boolean; slow: boolean; unsaved: boolean },
	): CodeAnswerContext | undefined {
		const language = codeLanguageOf(question);
		if (language === null || !props.username) return undefined;
		const saved = props.answers[slug];
		const at = props.answeredAt?.[slug];
		return {
			language,
			codeRun: props.codeRun ?? false,
			runnerOrigin: props.runnerOrigin ?? null,
			draft: draftRef(slug),
			value: typeof saved === "string" ? saved : "",
			valueSavedAt: at ? new Date(at) : null,
			clockOffsetMs: skew(),
			save: {
				state: status.slow ? "saving" : status.unsaved ? "unsaved" : "saved",
				savedAt: savedAt()[slug] ?? null,
				failingSince: failingSince()[slug] ?? null,
			},
			onConflict: (found) =>
				setConflicts(({ [slug]: _old, ...rest }) =>
					found ? { ...rest, [slug]: found } : rest,
				),
		};
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
		try {
			const saved = await flush();
			if (!saved) {
				// A lost session has its own notice; "fix the errors" would mislead.
				if (!sessionLost()) setFailure(m.exams_attempt_save_failed());
			} else {
				// The history flushes in parallel and is waited for only up to its own ceiling.
				const historyFlushed = flushHistoryFinal();
				const { error } = await actions.exam.finish(target);
				if (error?.code === "UNAUTHORIZED") setSessionLost(true);
				else if (error) setFailure(errorMessage(error));
				// The server decides what follows: awaiting grading, or the results.
				else {
					clearDrafts();
					await settleHistory(historyFlushed);
					window.location.reload();
				}
			}
		} catch {
			setFailure(m.exams_attempt_submit_unreachable());
		} finally {
			dialog?.close();
			setBusy(false);
		}
	}

	/// Warns before the page closes while some answer has not reached the server.
	function warnBeforeUnload(event: BeforeUnloadEvent): void {
		if (unsaved().size === 0) return;
		event.preventDefault();
		event.returnValue = "";
	}

	onMount(() => {
		const interval = setInterval(() => setNow(serverNow()), 1000);
		onCleanup(() => clearInterval(interval));
		window.addEventListener("beforeunload", warnBeforeUnload);
		window.addEventListener("online", retryNow);
		window.addEventListener("focus", kickSessionRetry);
		window.addEventListener("pagehide", flushHistoryNow);
		document.addEventListener("visibilitychange", onVisibilityChange);
		onCleanup(() => {
			window.removeEventListener("beforeunload", warnBeforeUnload);
			window.removeEventListener("online", retryNow);
			window.removeEventListener("focus", kickSessionRetry);
			window.removeEventListener("pagehide", flushHistoryNow);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		});
		if (kind() !== "in-progress") {
			clearSettledDrafts();
			removeSettledHistory();
		} else {
			startHistory();
			restoreDrafts();
		}
	});
	onCleanup(() => {
		historyStopped = true;
		withHistory((adapter) => adapter.disable("page closed"));
		for (const timer of timers.values()) clearTimeout(timer);
		if (retryTimer !== undefined) clearTimeout(retryTimer);
	});

	// The server refuses answers once the deadline passes, so whatever is still
	// pending is sent, and a draft newer than the saved answer is saved first,
	// while there is still time for it to land. Every tick tries again until it
	// does.
	createEffect(() => {
		const limit = deadline();
		if (kind() !== "in-progress" || !limit) return;
		if (secondsLeft(limit, now()) > DRAFT_SAVE_LEAD_SECONDS) return;
		keepNewerDrafts();
		void flush();
	});

	// Once the deadline passes the server refuses further answers after a short
	// grace: keep trying the last send until the grace ends and show the attempt as submitted, saying which answers did not
	// reach the server.
	createEffect(() => {
		const limit = deadline();
		if (kind() !== "in-progress" || !limit || now() <= limit || closing())
			return;
		keepNewerDrafts();
		setClosing(true);
		flushHistoryNow();
		void flushUntilGraceEnds(limit).then((saved) => {
			if (saved) clearDrafts();
			else setUndelivered(unsavedNumbers());
			setKind("submitted");
		});
	});

	return (
		<div class="flex flex-col gap-10">
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
								<Show when={undelivered().length > 0}>
									<p role="alert" class="alert alert-warning text-sm">
										{m.exams_attempt_undelivered({
											numbers: questionList(undelivered()),
										})}
									</p>
									<button
										type="button"
										class="btn btn-sm btn-outline self-start"
										onClick={() => void copyUnsent()}
									>
										{copied()
											? m.exams_attempt_copy_done()
											: m.exams_attempt_copy_unsent()}
									</button>
								</Show>
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
								answered: isAnswered(
									entry.question.type,
									answers()[entry.slug],
								),
								failed: saveErrors()[entry.slug] !== undefined,
								level: isAnswered(entry.question.type, answers()[entry.slug])
									? 1
									: waterLevel(weightOf(entry.question), remainingMean()),
							}))}
							current={current()}
							runsCode={runsCode()}
							saving={unsaved().size > 0}
							busy={busy()}
							onSubmit={() => dialog?.showModal()}
							notice={
								<Show when={sessionLost()}>
									<SessionLostNotice
										next={`${window.location.pathname}${window.location.search}`}
									/>
								</Show>
							}
						/>
					</Show>

					<Show when={closing() && kind() === "in-progress"}>
						<p role="status" class={NOTICE}>
							{m.exams_attempt_sending_last()}
						</p>
					</Show>

					<For each={props.questions}>
						{(entry, index) => {
							const answered = () =>
								isAnswered(entry.question.type, answers()[entry.slug]);
							const failed = () => saveErrors()[entry.slug] !== undefined;
							// Back to no answer at all, which a radio cannot be unticked to.
							const clearButton = () => (
								<Show
									when={
										kind() === "in-progress" &&
										codeLanguageOf(entry.question) === null &&
										(answers()[entry.slug] ?? null) !== null
									}
								>
									<button
										type="button"
										aria-label={m.exams_attempt_clear_answer()}
										class="btn btn-ghost btn-xs -mr-1.5 gap-1 whitespace-nowrap px-1.5 text-muted"
										onClick={() =>
											change(entry.slug, entry.question.type, null)
										}
									>
										<svg
											aria-hidden="true"
											viewBox="0 0 24 24"
											class="size-3.5 shrink-0"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
											<path d="M22 21H7" />
											<path d="m5 11 9 9" />
										</svg>
										{m.exams_attempt_clear()}
									</button>
								</Show>
							);
							const slowSave = createSlowFlag(
								() => unsaved().has(entry.slug),
								SLOW_SAVE_MS,
							);
							// Answered or not, never right or wrong: an answered number is
							// simply solid, an unanswered one faded, a failed save red.
							const tone = () =>
								failed()
									? "text-error"
									: kind() !== "in-progress" || answered()
										? "text-base-content"
										: "text-base-content/50";
							return (
								<section
									id={`question-${index() + 1}`}
									aria-label={m.exams_attempt_question_label({
										number: index() + 1,
									})}
									class={`grid gap-x-4 sm:grid-cols-[4.5rem_1fr] sm:grid-rows-[auto_1fr] ${QUESTION_SCROLL_MARGIN}`}
								>
									{/* The number stays in view while a long question scrolls past. */}
									<div class="hidden sm:col-start-1 sm:row-start-2 sm:block">
										<div class="sticky top-48 text-right">
											<QuestionNumber
												number={index() + 1}
												tone={tone()}
												class="block text-4xl"
											/>
											<Show when={weighted()}>
												<p class="mt-2 text-xs text-muted">
													{m.exams_attempt_points_label()}
												</p>
												<p class="text-sm font-semibold tabular-nums">
													{m.exams_attempt_points_value({
														points: formatPoints(shareOf(entry.question)),
													})}
												</p>
											</Show>
											<div class="mt-3">{clearButton()}</div>
										</div>
									</div>
									{/* A file-folder tab: as wide as the title, its right edge slanted. */}
									<header class="relative z-10 inline-flex min-w-1/3 max-w-[calc(100%-1.5rem)] items-baseline gap-3 justify-self-start sm:col-start-2 py-2 pr-6 pl-6">
										<span
											aria-hidden="true"
											class="absolute inset-y-0 left-0 right-2 -z-10 rounded-tl-[18px_8px] bg-linear-to-b from-base-300 to-[color-mix(in_oklab,var(--color-base-300)_75%,var(--color-base-200))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-base-100)_70%,transparent)]"
										/>
										<span
											aria-hidden="true"
											class="absolute inset-y-0 -right-3 -z-10 w-9 origin-bottom skew-x-[18deg] rounded-tr-xl bg-linear-to-b from-base-300 to-[color-mix(in_oklab,var(--color-base-300)_75%,var(--color-base-200))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--color-base-100)_70%,transparent)]"
										/>
										<QuestionNumber
											number={index() + 1}
											tone={tone()}
											class="text-xl sm:hidden"
										/>
										<h3 class="min-w-0 truncate font-display text-base font-semibold text-shadow-[0_0_3px_var(--color-base-100),0_0_10px_var(--color-base-100),0_0_18px_var(--color-base-100)]">
											{entry.question.title ??
												m.exams_attempt_question_label({ number: index() + 1 })}
										</h3>
										<Show when={weighted()}>
											<span class="whitespace-nowrap text-xs tabular-nums sm:hidden">
												{m.exams_attempt_points({
													points: formatPoints(shareOf(entry.question)),
												})}
											</span>
										</Show>
										<Show when={kind() === "in-progress"}>
											<SaveState
												failed={failed()}
												saving={slowSave()}
												pending={unsaved().has(entry.slug)}
												confirmed={confirmed().has(entry.slug)}
												answered={answered()}
											/>
										</Show>
									</header>
									<div class="card card-border min-w-0 overflow-hidden rounded-tl-none! bg-base-200/25 shadow-sm sm:col-start-2">
										{/* focusout bubbles, so leaving any control of the question saves it. */}
										<div
											class="card-body"
											onFocusOut={() => saveNow(entry.slug)}
											onBeforeInput={(event) =>
												announceInput(entry.slug, event)
											}
										>
											<AnswerField
												question={entry.question}
												payload={answers()[entry.slug]}
												readonly={kind() !== "in-progress" || closing()}
												review={
													kind() === "results"
														? props.reviews?.[entry.slug]
														: undefined
												}
												onChange={(payload, userEvent) =>
													change(
														entry.slug,
														entry.question.type,
														payload,
														userEvent,
													)
												}
												pretests={props.pretests?.[entry.slug]}
												exampleHtml={props.exampleHtml?.[entry.slug]}
												sends={allSends()[entry.slug]}
												onSubmit={(code) => submitCode(entry.slug, code)}
												runnerOrigin={props.runnerOrigin ?? null}
												code={
													kind() === "in-progress"
														? codeContext(entry.slug, entry.question, {
																failed: failed(),
																slow: slowSave(),
																unsaved: unsaved().has(entry.slug),
															})
														: undefined
												}
											/>
											<div class="self-end sm:hidden">{clearButton()}</div>
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
											{/* A lost session has its own notice above. */}
											<Show
												when={
													saveErrors()[entry.slug] !== undefined &&
													!sessionLost()
												}
											>
												<p role="alert" class="text-sm text-error">
													{saveErrors()[entry.slug]
														? m.exams_attempt_save_error({
																message: saveErrors()[entry.slug] ?? "",
															})
														: m.exams_attempt_save_error_unknown()}
												</p>
											</Show>
										</div>
									</div>
								</section>
							);
						}}
					</For>

					<dialog ref={dialog} class="modal">
						<div class="modal-box">
							<h3 class="text-lg font-bold">
								{m.exams_attempt_submit_title({ type: props.type })}
							</h3>
							<p class="mt-2 text-sm text-base-content/70">
								{m.exams_attempt_submit_body()}
							</p>
							<Show when={unansweredNumbers().length > 0}>
								<p role="alert" class="alert alert-warning mt-3 text-sm">
									{unansweredWarning(unansweredNumbers())}
								</p>
							</Show>
							<Show when={conflictNumbers().length > 0}>
								<p role="alert" class="alert alert-warning mt-3 text-sm">
									{m.exams_attempt_submit_conflict({
										numbers: questionList(conflictNumbers()),
									})}
								</p>
							</Show>
							<Show when={unsortedNumbers().length > 0}>
								<p role="alert" class="alert alert-warning mt-3 text-sm">
									{m.exams_attempt_submit_skips_ordering({
										count: unsortedNumbers().length,
										numbers: questionList(unsortedNumbers()),
									})}
								</p>
							</Show>
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
	questions: {
		number: number;
		answered: boolean;
		failed: boolean;
		/// How full the button's water is, in [0, 1]: full once answered, else see `waterLevel`.
		level: number;
	}[];
	/// The number of the question in view, if any.
	current: number | null;
	/// Whether some question runs code in the browser, which the bar says next to the clock.
	runsCode: boolean;
	/// Whether some change still waits for the server.
	saving: boolean;
	busy: boolean;
	onSubmit: () => void;
	/// Shown under the bar's controls, inside the part that stays in view.
	notice?: JSX.Element;
}

/// The bar that stays in view while answering: time, progress, saving, submit, and a way to each question.
function AttemptBar(props: AttemptBarProps): JSX.Element {
	const answered = () => props.questions.filter((q) => q.answered).length;
	const failed = () => props.questions.filter((q) => q.failed).length;

	const saving = createSlowFlag(() => props.saving, SLOW_SAVE_MS);

	// On a phone the buttons keep to one row that scrolls sideways, with an
	// arrow on each side while there is more to see that way.
	let strip: HTMLElement | undefined;
	const [canBack, setCanBack] = createSignal(false);
	const [canForward, setCanForward] = createSignal(false);
	function measure(): void {
		if (!strip) return;
		setCanBack(strip.scrollLeft > 1);
		setCanForward(strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
	}
	function page(direction: 1 | -1): void {
		strip?.scrollBy({
			left: direction * strip.clientWidth * 0.8,
			behavior: "smooth",
		});
	}
	onMount(() => {
		measure();
		const observer = new ResizeObserver(measure);
		if (strip) observer.observe(strip);
		onCleanup(() => observer.disconnect());
	});
	// Keeps the question in view on the page in view on the strip too.
	createEffect(() => {
		const number = props.current;
		if (!strip || number === null) return;
		const link = strip.querySelector<HTMLElement>(
			`a[href="#question-${number}"]`,
		);
		if (!link) return;
		const left = link.offsetLeft - strip.offsetLeft;
		const right = left + link.offsetWidth;
		if (left < strip.scrollLeft) {
			strip.scrollTo({ left: left - 8, behavior: "smooth" });
		} else if (right > strip.scrollLeft + strip.clientWidth) {
			strip.scrollTo({
				left: right - strip.clientWidth + 8,
				behavior: "smooth",
			});
		}
	});
	const saveStatus = () => (
		<StackedLabel
			labels={[
				{
					when: failed() > 0,
					text: m.exams_attempt_answers_not_saved({ count: failed() }),
					class: "text-error",
				},
				{
					when: saving(),
					text: m.exams_attempt_saving(),
					class: "text-muted",
				},
				{
					when: answered() > 0,
					text: m.exams_attempt_all_saved(),
					class: `text-muted transition-opacity ${props.saving ? "opacity-40" : ""}`,
				},
			]}
		/>
	);

	return (
		<div class="sticky top-16 z-20 -mx-4 border-b border-base-300 bg-base-100 px-4 py-3">
			<div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
				<Show
					when={props.seconds !== null}
					fallback={
						<span class="font-semibold">{m.exams_attempt_no_time_limit()}</span>
					}
				>
					<span
						class={`font-semibold tabular-nums ${timeClass(props.seconds ?? 0)}`}
					>
						{timeLeft(props.seconds ?? 0)}
					</span>
				</Show>
				<span class="text-muted">
					{m.exams_attempt_progress({
						answered: answered(),
						total: props.questions.length,
					})}
				</span>
				<Show when={props.runsCode}>
					<span class="badge badge-soft badge-success badge-sm" data-code-badge>
						{m.exams_attempt_code_badge()}
					</span>
				</Show>
				<span class="hidden sm:inline">{saveStatus()}</span>
			</div>
			<div class="mt-2 flex items-center gap-1 sm:items-start sm:gap-3">
				<ScrollArrow
					direction={-1}
					enabled={canBack()}
					onClick={() => page(-1)}
				/>
				<nav
					ref={strip}
					aria-label={m.exams_attempt_nav_label()}
					onScroll={measure}
					class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto p-1 [scrollbar-width:none] sm:flex-wrap sm:justify-center sm:overflow-visible sm:p-0"
				>
					<Index each={props.questions}>
						{(question) => (
							<a
								href={`#question-${question().number}`}
								aria-label={
									question().answered
										? m.exams_attempt_question_answered({
												number: question().number,
											})
										: m.exams_attempt_question_label({
												number: question().number,
											})
								}
								aria-current={
									props.current === question().number ? "location" : undefined
								}
								class={`btn btn-sm group relative isolate overflow-hidden hover:bg-transparent hover:border-base-content hover:text-base-content flex-col gap-0 font-mono h-11 w-12 shrink-0 px-1 sm:w-auto sm:min-w-12 sm:max-w-20 sm:flex-1 sm:shrink ${
									question().failed
										? "btn-error"
										: question().answered
											? "btn-outline border-base-content/70 text-base-content"
											: "btn-outline border-base-content/15 text-base-content/50"
								} ${props.current === question().number ? "outline-2 outline-offset-2 outline-primary" : ""}`}
							>
								<span
									aria-hidden="true"
									class="water group-hover:[--water-color:var(--color-base-300)]"
									style={{
										height: `${question().level * 100}%`,
										"--water-phase": `${(question().number * -1.7) % 7}s`,
									}}
								/>
								<span class="relative">
									{m.exams_attempt_question_short({
										number: question().number,
									})}
								</span>
							</a>
						)}
					</Index>
				</nav>
				<ScrollArrow
					direction={1}
					enabled={canForward()}
					onClick={() => page(1)}
				/>
				<button
					type="button"
					aria-label={m.exams_attempt_submit({ type: props.type })}
					class="btn btn-primary btn-sm h-11 shrink-0 gap-1.5"
					disabled={props.busy}
					onClick={props.onSubmit}
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						class="size-4"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M14.5 21.5 22 2 2.5 9.5l7.5 3.5 4.5 8.5Z" />
						<path d="M22 2 10 13" />
					</svg>
					<span class="hidden sm:inline">{m.exams_attempt_submit_short()}</span>
				</button>
			</div>
			<p class="mt-1 text-xs sm:hidden">{saveStatus()}</p>
			{props.notice}
		</div>
	);
}

/// The notice that the session ended, with a link to log in again in a new tab and come back to this exam.
function SessionLostNotice(props: { next: string }): JSX.Element {
	const href = () => `/login?next=${encodeURIComponent(props.next)}`;
	return (
		<div role="alert" class="alert alert-error mt-2 text-sm">
			<span>{m.exams_attempt_session_lost()}</span>
			<a
				href={href()}
				target="_blank"
				rel="noopener"
				class="btn btn-sm btn-primary"
			>
				{m.exams_attempt_session_lost_link()}
			</a>
		</div>
	);
}

/// An arrow that pages the question strip sideways; phones only, since wider screens wrap the strip.
function ScrollArrow(props: {
	direction: 1 | -1;
	enabled: boolean;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={
				props.direction < 0
					? m.exams_attempt_nav_back()
					: m.exams_attempt_nav_forward()
			}
			class="btn btn-ghost btn-sm h-11 w-6 shrink-0 px-0 disabled:bg-transparent sm:hidden"
			disabled={!props.enabled}
			onClick={props.onClick}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				class="size-4"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d={props.direction < 0 ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
			</svg>
		</button>
	);
}

/// How sharply the water level moves away from half as a weight leaves the mean.
const WATER_STEEPNESS = 1.5;

/**
 * The water level, in [0, 1], of a question weighing `weight` in an exam whose
 * mean weight is `mean`: half at the mean, toward 1 above it, toward 0 below.
 *
 * @example
 * waterLevel(1, 1) // 0.5
 * waterLevel(3, 1.5) // ≈ 0.74
 */
function waterLevel(weight: number, mean: number): number {
	if (mean <= 0) return 0.5;
	const ratio = (weight / mean) ** WATER_STEEPNESS;
	return ratio / (1 + ratio);
}

/// The weight a question declares, 1 when it declares none.
function weightOf(question: QuestionPublic["question"]): number {
	return question.weight ?? 1;
}

/// "Q3", the label students and instructors use to refer to a question.
function QuestionNumber(props: {
	number: number;
	tone: string;
	class?: string;
}): JSX.Element {
	return (
		<span
			class={`font-display font-semibold leading-none tracking-tight ${props.tone} ${props.class ?? ""}`}
		>
			{m.exams_attempt_question_short({ number: props.number })}
		</span>
	);
}

/// A part of the total as points out of 100, up to one decimal: `15`, `7.5`.
function formatPoints(share: number): string {
	return (share * 100).toLocaleString(locale, { maximumFractionDigits: 1 });
}

/**
 * One question's save state while answering; nothing until it has an answer.
 *
 * A change the server has not confirmed yet dims the last "Saved" rather
 * than replacing it, so a quick save does not flash; "Saving…" shows only
 * once `saving` says it is slow.
 */
function SaveState(props: {
	failed: boolean;
	saving: boolean;
	pending: boolean;
	confirmed: boolean;
	answered: boolean;
}): JSX.Element {
	return (
		<StackedLabel
			class="text-xs"
			labels={[
				{
					when: props.failed,
					text: m.exams_attempt_not_saved(),
					class: "text-error",
				},
				{
					when: props.saving,
					text: m.exams_attempt_saving(),
					class: "text-muted",
				},
				{
					when: props.answered && (props.confirmed || !props.pending),
					text: m.exams_attempt_saved(),
					class: `text-muted transition-opacity ${props.pending ? "opacity-40" : ""}`,
				},
			]}
		/>
	);
}

/**
 * The first label whose `when` holds, in a box as wide as the widest label,
 * so switching between them never moves what is around it.
 *
 * The other labels take their room as invisible `::before` text, which
 * assistive technology and text queries do not see.
 */
function StackedLabel(props: {
	labels: { when: boolean; text: string; class: string }[];
	class?: string;
}): JSX.Element {
	const shown = () => props.labels.find((label) => label.when);
	return (
		<span class={`inline-grid whitespace-nowrap ${props.class ?? ""}`}>
			<For each={props.labels}>
				{(label) => (
					<span
						aria-hidden="true"
						data-text={label.text}
						class="invisible col-start-1 row-start-1 before:content-[attr(data-text)]"
					/>
				)}
			</For>
			<Show when={shown()}>
				{(label) => (
					<span class={`col-start-1 row-start-1 ${label().class}`}>
						{label().text}
					</span>
				)}
			</Show>
		</span>
	);
}

/**
 * Follows `source`, but turns true only once it has stayed true for `ms`.
 *
 * A save the server confirms at once then never flashes "Saving…".
 */
function createSlowFlag(source: () => boolean, ms: number): () => boolean {
	const [slow, setSlow] = createSignal(false);
	createEffect(() => {
		if (!source()) {
			setSlow(false);
			return;
		}
		const timer = setTimeout(() => setSlow(true), ms);
		onCleanup(() => clearTimeout(timer));
	});
	return slow;
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
								<span class="font-normal text-muted">
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
					<AppliedItems items={outcome().rubricItems ?? []} />
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
	/// The answer's marks and feedback, shown in `review` mode; the score is the outcome's, below.
	review?: ReviewResult;
	onChange: (payload: AnswerPayload, userEvent?: string) => void;
	/// Set for a code question being answered: it gets the editor instead of the textarea.
	code?: CodeAnswerContext;
	/// The pretest sources of an MDQ `code` question, from the server.
	pretests?: readonly PretestSource[];
	/// The highlighted example tests of an MDQ `code` question, from the server.
	exampleHtml?: readonly string[];
	/// The sends of a code question that goes to a worker; without it the question has no submit button.
	sends?: CodeSends;
	/// Sends the code of the question to its worker.
	onSubmit?: (code: string) => Promise<void>;
	/// Origin of the runner iframe the pretests run in.
	runnerOrigin?: string | null;
}

/// What a code question in answer mode needs besides the question itself.
type CodeAnswerContext = Pick<
	CodeEssayAnswerProps,
	| "language"
	| "value"
	| "valueSavedAt"
	| "clockOffsetMs"
	| "save"
	| "codeRun"
	| "runnerOrigin"
	| "draft"
	| "onConflict"
>;

/// The runner language of an essay question whose answer is code a driver runs, or null.
function codeLanguageOf(
	question: QuestionPublic["question"],
): LanguageId | null {
	return question.type === "essay" && question.content === "code"
		? runnerLanguage(question.highlight)
		: null;
}

/// One question in answer mode, frozen on the student's saved answer, or reviewed with its marks.
function AnswerField(props: AnswerFieldProps): JSX.Element {
	return (
		<Show
			when={
				props.question.type === "code" && !props.readonly && !props.review
					? props.question
					: undefined
			}
			fallback={<EssayOrOtherField {...props} />}
		>
			{(question) => (
				<CodeAnswer
					question={question()}
					pretests={props.pretests ?? []}
					exampleHtml={props.exampleHtml}
					onSubmit={props.sends ? props.onSubmit : undefined}
					sends={props.sends}
					runnerOrigin={props.runnerOrigin ?? null}
					value={typeof props.payload === "string" ? props.payload : null}
					onChange={(code, userEvent) => props.onChange(code, userEvent)}
				/>
			)}
		</Show>
	);
}

/// Every question that is not an MDQ `code` question being answered.
function EssayOrOtherField(props: AnswerFieldProps): JSX.Element {
	return (
		<Show
			when={
				props.code &&
				!props.readonly &&
				!props.review &&
				props.question.type === "essay"
					? props.code
					: undefined
			}
			fallback={
				<AnyQuestionView
					question={props.question}
					value={props.payload ?? null}
					onChange={props.onChange}
					mode={
						props.review ? "review" : props.readonly ? "readonly" : "answer"
					}
					result={props.review}
					hideScore
					messages={mdqMessages}
				/>
			}
		>
			{(code) => (
				<CodeEssayAnswer
					stem={props.question.type === "essay" ? props.question.stem : ""}
					epilogue={
						props.question.type === "essay"
							? props.question.epilogue
							: undefined
					}
					language={code().language}
					value={code().value}
					valueSavedAt={code().valueSavedAt}
					clockOffsetMs={code().clockOffsetMs}
					onChange={props.onChange}
					save={code().save}
					codeRun={code().codeRun}
					runnerOrigin={code().runnerOrigin}
					draft={code().draft}
					onConflict={code().onConflict}
				/>
			)}
		</Show>
	);
}
