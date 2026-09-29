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
import EssayView from "@/components/question/EssayView";
import FillInView from "@/components/question/FillInView";
import MultipleChoiceView from "@/components/question/MultipleChoiceView";
import MultipleSelectionView from "@/components/question/MultipleSelectionView";
import NumericView from "@/components/question/NumericView";
import ShortAnswerView from "@/components/question/ShortAnswerView";
import TrueFalseView from "@/components/question/TrueFalseView";
import type { AttemptState, QuestionPublic } from "@/db";
import type {
	PublicEssay,
	PublicFillIn,
	PublicMultipleChoice,
	PublicMultipleSelection,
	PublicNumeric,
	PublicShortAnswer,
	PublicTrueFalse,
} from "@/mdq/public";
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
	isTextEntry,
	numberOf,
	textOf,
} from "./answer-payload";

export interface ExamAttemptProps {
	/// The course's URL segments and the exam slug, as the exam actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// Where the viewing student stands, computed on the server at `now`.
	state: AttemptState;
	/// Server time when the page rendered, so the countdown ignores client clock skew.
	now: Date;
	/// The exam's questions, public half only, in exam order.
	questions: { slug: string; question: QuestionPublic["question"] }[];
	/// The student's latest answer per question slug.
	answers: Record<string, AnswerPayload>;
}

/// How long typing pauses before a text answer is saved.
const SAVE_DELAY_MS = 500;

const RELATIVE = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/// A moment as "in 3 days" when it is within a week, and as a full date otherwise.
function relativeOrAbsolute(date: Date, now: Date): string {
	const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
	if (minutes < 60) return RELATIVE.format(minutes, "minute");
	if (minutes < 24 * 60)
		return RELATIVE.format(Math.round(minutes / 60), "hour");
	if (minutes < 7 * 24 * 60) {
		return RELATIVE.format(Math.round(minutes / (24 * 60)), "day");
	}
	return formatDateTime(date, { year: "numeric" });
}

/// The time left until `deadline` as "42 min left", or seconds in the last minute.
function timeLeft(deadline: Date, now: Date): string {
	const seconds = Math.max(
		0,
		Math.ceil((deadline.getTime() - now.getTime()) / 1000),
	);
	if (seconds < 60) return `${seconds} s left`;
	return `${Math.ceil(seconds / 60)} min left`;
}

/**
 * A student's side of an exam page: the one action their state allows, and the questions.
 *
 * `not-open` shows when the exam opens; `can-start` offers "Start exam";
 * `in-progress` renders the questions in answer mode, saves each answer as it
 * changes, shows the time left, and offers "Submit exam" behind a
 * confirmation; `submitted` shows the saved answers read-only; `missed` says
 * the student did not take it.
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

	function saveNow(slug: string): void {
		const timer = timers.get(slug);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(slug);

		const payload = pending.get(slug);
		if (payload === undefined) return;
		pending.delete(slug);

		queue = queue.then(async () => {
			const { error } = await actions.exam.answer({
				...target,
				question: slug,
				payload,
			});
			if (!error) {
				setSaveError(slug, null);
				return;
			}

			// A newer answer typed meanwhile supersedes the failed one.
			if (!pending.has(slug)) pending.set(slug, payload);
			setSaveError(slug, error.message);
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
			setFailure(error.message);
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
			setFailure(
				"Some answers could not be saved. Fix the errors and try again.",
			);
		} else {
			const { error } = await actions.exam.finish(target);
			if (error) setFailure(error.message);
			else setKind("submitted");
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
			<Show when={failure()}>
				{(message) => (
					<div role="alert" class="alert alert-error">
						{message()}
					</div>
				)}
			</Show>

			<Switch>
				<Match when={kind() === "not-open"}>
					<p class="text-lg font-medium">
						<Show when={opensAt()} fallback="Not open yet">
							{(date) => (
								<>
									Opens{" "}
									<time
										datetime={date().toISOString()}
										title={formatDateTime(date(), { year: "numeric" })}
									>
										{relativeOrAbsolute(date(), now())}
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
							Start exam
						</button>
					</div>
				</Match>

				<Match when={kind() === "missed"}>
					<p class="text-lg font-medium">You did not take this exam</p>
				</Match>

				<Match when={kind() === "in-progress" || kind() === "submitted"}>
					<div class="flex flex-wrap items-center justify-between gap-3">
						<Show
							when={kind() === "in-progress"}
							fallback={<p class="text-lg font-medium">Submitted</p>}
						>
							<span class="text-lg font-medium">
								<Show when={deadline()} fallback="Take your time">
									{(limit) => timeLeft(limit(), now())}
								</Show>
							</span>
							<button
								type="button"
								class="btn btn-primary"
								disabled={busy()}
								onClick={() => dialog?.showModal()}
							>
								Submit exam
							</button>
						</Show>
					</div>

					<For each={props.questions}>
						{(entry) => (
							<div class="card card-border overflow-hidden bg-base-100/50 shadow-md">
								<div class="stripe-brand h-1.5" />
								{/* focusout bubbles, so leaving any control of the question saves it. */}
								<div class="card-body" onFocusOut={() => saveNow(entry.slug)}>
									<AnswerField
										question={entry.question}
										payload={answers()[entry.slug]}
										readonly={kind() !== "in-progress"}
										onChange={(payload) =>
											change(entry.slug, entry.question.type, payload)
										}
									/>
									<Show when={saveErrors()[entry.slug]}>
										{(message) => (
											<p role="alert" class="text-sm text-error">
												Could not save this answer: {message()}. It will be
												retried when you change it or submit.
											</p>
										)}
									</Show>
								</div>
							</div>
						)}
					</For>

					<dialog ref={dialog} class="modal">
						<div class="modal-box">
							<h3 class="text-lg font-bold">Submit this exam?</h3>
							<p class="mt-2 text-sm text-base-content/70">
								Your answers can't be changed after you submit. They are kept
								and sent for grading. Questions you left blank stay blank.
							</p>
							<div class="modal-action">
								<button
									type="button"
									class="btn btn-ghost"
									disabled={busy()}
									onClick={() => dialog?.close()}
								>
									Cancel
								</button>
								<button
									type="button"
									class="btn btn-primary"
									disabled={busy()}
									onClick={submit}
								>
									Submit exam
								</button>
							</div>
						</div>
						<form method="dialog" class="modal-backdrop">
							<button type="submit">close</button>
						</form>
					</dialog>
				</Match>
			</Switch>
		</div>
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
					Answering "{props.question.type}" questions is not supported yet.
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
