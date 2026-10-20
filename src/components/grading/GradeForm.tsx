import { actions } from "astro:actions";
import { type JSX, Show } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { answerGrade } from "@/core/schemas";
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
	const form = createSchemaForm(answerGrade, {
		id: `grade-${props.submission}`,
		action: actions.grading.grade,
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
			<FormAlert error={form.error()} />
			<Field
				{...form.field("score")}
				control={{
					inputmode: "numeric",
					autocomplete: "off",
					"data-score-input": "",
				}}
			/>
			<Field {...form.field("comment")} />
			<div class="flex gap-2">
				<button type="submit" class="btn btn-primary" disabled={form.busy()}>
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
		</form>
	);
}
