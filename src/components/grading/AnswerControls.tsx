import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";
import { FOCUS_KEY } from "./focus";
import GradeForm from "./GradeForm";

export interface AnswerControlsProps {
	/// The course's URL segments and the exam slug, as the grading actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// The `publicId` of the answer.
	submission: string;
	/// Where the answer stands: waiting for a grade, graded, or marked will-not-grade.
	state: "pending" | "graded" | "not-graded";
}

/**
 * What the instructor can do to one answer: grade it, change its grade, or mark it will-not-grade.
 *
 * A pending answer shows its grading form at once. A resolved one offers
 * "Change grade", which reveals the same form. "Will not grade" asks for a
 * comment for the student in a dialog first. Each action reloads the page so
 * the answer moves and the numbering follows the server.
 */
export default function AnswerControls(
	props: AnswerControlsProps,
): JSX.Element {
	const [changing, setChanging] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	const titleId = `wng-title-${props.submission}`;
	const commentId = `wng-comment-${props.submission}`;
	let dialog: HTMLDialogElement | undefined;
	let comment: HTMLTextAreaElement | undefined;

	function cancelDialog(): void {
		setFailure(null);
		if (comment) comment.value = "";
		dialog?.close();
	}

	async function markNotGraded(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.grading.willNotGrade({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			submission: props.submission,
			comment: comment?.value ?? "",
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
		<div class="mt-4 flex flex-col gap-3">
			<Show when={props.state === "pending" || changing()}>
				<GradeForm
					discipline={props.discipline}
					course={props.course}
					exam={props.exam}
					submission={props.submission}
					onCancel={
						props.state === "pending" ? undefined : () => setChanging(false)
					}
				/>
			</Show>

			<div class="flex flex-wrap gap-2">
				<Show when={props.state !== "pending" && !changing()}>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						onClick={() => setChanging(true)}
					>
						Change grade
					</button>
				</Show>
				<Show when={props.state !== "not-graded"}>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						onClick={() => dialog?.showModal()}
					>
						Will not grade
					</button>
				</Show>
			</div>

			<dialog ref={dialog} class="modal" aria-labelledby={titleId}>
				<div class="modal-box">
					<h3 id={titleId} class="text-lg font-bold">
						Will not grade this answer?
					</h3>
					<p class="mt-2 text-sm text-base-content/70">
						The answer counts as zero in the total, and the student reads "Not
						graded". Earlier grades are kept, and you can grade the answer later
						with "Change grade".
					</p>
					<div class="mt-4 flex flex-col gap-1">
						<label for={commentId} class="text-sm font-medium">
							Comment for the student
						</label>
						<textarea
							ref={comment}
							id={commentId}
							rows="3"
							class="textarea textarea-bordered w-full"
						/>
					</div>
					<Show when={failure()}>
						{(message) => (
							<p role="alert" class="mt-2 text-sm text-error">
								{message()}
							</p>
						)}
					</Show>
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							disabled={busy()}
							onClick={cancelDialog}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn btn-primary"
							disabled={busy()}
							onClick={markNotGraded}
						>
							Mark as not graded
						</button>
					</div>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">close</button>
				</form>
			</dialog>
		</div>
	);
}
