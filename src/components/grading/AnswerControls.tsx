import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { answerWillNotGrade } from "@/core/schemas";
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
	const [dialogOpen, setDialogOpen] = createSignal(false);
	const titleId = `wng-title-${props.submission}`;
	let dialog: HTMLDialogElement | undefined;

	function openDialog(): void {
		setDialogOpen(true);
		dialog?.showModal();
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
						onClick={openDialog}
					>
						Will not grade
					</button>
				</Show>
			</div>

			<dialog
				ref={dialog}
				class="modal"
				aria-labelledby={titleId}
				onClose={() => setDialogOpen(false)}
			>
				<div class="modal-box">
					<h3 id={titleId} class="text-lg font-bold">
						Will not grade this answer?
					</h3>
					<p class="mt-2 text-sm text-base-content/70">
						The answer counts as zero in the total, and the student reads "Not
						graded". Earlier grades are kept, and you can grade the answer later
						with "Change grade".
					</p>
					<Show when={dialogOpen()}>
						<WillNotGradeForm
							discipline={props.discipline}
							course={props.course}
							exam={props.exam}
							submission={props.submission}
							onCancel={() => dialog?.close()}
						/>
					</Show>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">close</button>
				</form>
			</dialog>
		</div>
	);
}

/// The dialog's form: a comment for the student and the buttons that mark the answer or cancel.
function WillNotGradeForm(
	props: Pick<
		AnswerControlsProps,
		"discipline" | "course" | "exam" | "submission"
	> & { onCancel: () => void },
): JSX.Element {
	const form = createSchemaForm(answerWillNotGrade, {
		id: `wng-${props.submission}`,
		action: actions.grading.willNotGrade,
		hidden: {
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			submission: props.submission,
		},
		onSuccess: () => {
			sessionStorage.setItem(FOCUS_KEY, window.location.pathname);
			window.location.reload();
		},
	});

	return (
		<form noValidate class="mt-4 flex flex-col gap-3" onSubmit={form.submit}>
			<Field {...form.field("comment")} />
			<FormAlert error={form.error()} />
			<div class="modal-action">
				<button
					type="button"
					class="btn btn-ghost"
					disabled={form.busy()}
					onClick={props.onCancel}
				>
					Cancel
				</button>
				<button type="submit" class="btn btn-primary" disabled={form.busy()}>
					Mark as not graded
				</button>
			</div>
		</form>
	);
}
