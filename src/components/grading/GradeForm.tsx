import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";
import { FOCUS_KEY } from "./focus";

export interface GradeFormProps {
	/// The course's URL segments and the exam slug, as the grading action takes them.
	discipline: string;
	course: string;
	exam: string;
	/// The `publicId` of the answer being graded.
	submission: string;
	/// When given, the form offers a Cancel button that calls it.
	onCancel?: () => void;
}

/**
 * The form that records a new grading pass on one answer.
 *
 * Saving reloads the page, so the answer moves under "Graded" and the queue
 * is renumbered by the server; the reload asks the page to focus the score of
 * the next pending answer. A refused score or write is shown on the form.
 * Cancelling only calls `onCancel`; nothing is written.
 */
export default function GradeForm(props: GradeFormProps): JSX.Element {
	const scoreId = `score-${props.submission}`;
	const commentId = `comment-${props.submission}`;
	const [failure, setFailure] = createSignal<string | null>(null);
	const [busy, setBusy] = createSignal(false);

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const data = new FormData(event.currentTarget as HTMLFormElement);
		setBusy(true);
		setFailure(null);
		const { error } = await actions.grading.grade({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			submission: props.submission,
			score: String(data.get("score") ?? ""),
			comment: String(data.get("comment") ?? ""),
		});
		if (error) {
			setFailure(error.message);
			setBusy(false);
			return;
		}
		sessionStorage.setItem(FOCUS_KEY, window.location.pathname);
		window.location.reload();
	}

	return (
		<form noValidate class="mt-4 flex flex-col gap-3" onSubmit={save}>
			<div class="flex flex-col gap-1">
				<label for={scoreId} class="text-sm font-medium">
					Score (%)
				</label>
				<input
					id={scoreId}
					name="score"
					type="text"
					inputmode="numeric"
					autocomplete="off"
					data-score-input
					class="input input-bordered w-32"
				/>
			</div>
			<div class="flex flex-col gap-1">
				<label for={commentId} class="text-sm font-medium">
					Comment
				</label>
				<textarea
					id={commentId}
					name="comment"
					rows="3"
					class="textarea textarea-bordered w-full"
				/>
			</div>
			<Show when={failure()}>
				{(message) => (
					<p role="alert" class="text-sm text-error">
						{message()}
					</p>
				)}
			</Show>
			<div>
				<div class="flex gap-2">
					<button type="submit" class="btn btn-primary" disabled={busy()}>
						Save grade
					</button>
					<Show when={props.onCancel}>
						{(cancel) => (
							<button type="button" class="btn btn-ghost" onClick={cancel()}>
								Cancel
							</button>
						)}
					</Show>
				</div>
			</div>
		</form>
	);
}
