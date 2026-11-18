import { createSignal, type JSX, Show } from "solid-js";
import { isPercentScore, SCORE_ERROR } from "@/core/score";
import { m } from "@/i18n";
import { type GradeTarget, recordGrade } from "./grade-actions";

export interface GradeQuestionFormProps {
	target: GradeTarget;
	/// The answer's `publicId`, or `null` when the student left the question blank.
	submission: string | null;
	/// The student's username.
	author: string;
	/// The grade now, as a whole percentage, or `null` when there is none.
	current: number | null;
	/// Called when the form is cancelled; a save reloads the page instead.
	onDone: () => void;
}

/**
 * The form that changes the grade of one student on the question: a percentage and a comment.
 *
 * "Mark as correct" saves 100 at once, or "Mark as wrong" saves 0 when the grade is already 100. Saving the grade the
 * answer already has is disabled. Saving reloads the page.
 */
export default function GradeQuestionForm(
	props: GradeQuestionFormProps,
): JSX.Element {
	const [score, setScore] = createSignal(
		props.current === null ? "" : String(props.current),
	);
	const [comment, setComment] = createSignal("");
	const [error, setError] = createSignal<string>();
	const [busy, setBusy] = createSignal(false);
	/// Whether the typed grade is the one the answer already has.
	const unchanged = () =>
		props.current !== null &&
		isPercentScore(score()) &&
		Number(score()) === props.current;
	const full = () => props.current === 100;

	async function save(text: string): Promise<void> {
		if (!isPercentScore(text)) {
			setError(SCORE_ERROR);
			return;
		}
		setBusy(true);
		setError(undefined);
		const failure = await recordGrade(
			props.target,
			{ submission: props.submission, author: props.author },
			{ score: text, comment: comment() },
		);
		if (failure) {
			setError(failure);
			setBusy(false);
			return;
		}
		// The form stays mounted until the reload: closing it first would read its props after the unmount.
		window.location.reload();
	}

	return (
		<form
			noValidate
			class="flex flex-wrap items-end gap-3 rounded-box border border-edge bg-base-200/40 px-4 py-3"
			onSubmit={(event) => {
				event.preventDefault();
				void save(score());
			}}
		>
			<label class="flex flex-col gap-1 text-xs text-muted">
				{m.grades_objective_grade_label()}
				<input
					type="number"
					min="0"
					max="100"
					value={score()}
					class="input input-sm w-24 text-base-content"
					onInput={(event) => setScore(event.currentTarget.value)}
				/>
			</label>
			<button
				type="button"
				class={`btn btn-soft btn-sm ${full() ? "btn-error" : "btn-success"}`}
				disabled={busy()}
				onClick={() => void save(full() ? "0" : "100")}
			>
				{full()
					? m.grades_objective_mark_wrong()
					: m.grades_objective_mark_correct()}
			</button>
			<label class="flex min-w-48 grow flex-col gap-1 text-xs text-muted">
				{m.grades_objective_comment_optional()}
				<input
					type="text"
					value={comment()}
					class="input input-sm w-full text-base-content"
					onInput={(event) => setComment(event.currentTarget.value)}
				/>
			</label>
			<button
				type="submit"
				class="btn btn-primary btn-sm"
				disabled={busy() || unchanged()}
			>
				{m.grades_objective_save()}
			</button>
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				onClick={() => props.onDone()}
			>
				{m.grades_objective_cancel()}
			</button>
			<Show when={error()}>
				<p role="alert" class="w-full text-sm text-error">
					{error()}
				</p>
			</Show>
		</form>
	);
}
