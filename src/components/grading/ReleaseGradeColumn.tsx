import { actions } from "astro:actions";
import { createSignal, type JSX } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";

export interface ReleaseGradeColumnProps {
	/// The course's URL segments and the column slug, as the action takes them.
	discipline: string;
	course: string;
	slug: string;
	title: string;
	/// How many of the listed students have a value in the column.
	valued: number;
}

/**
 * The instructor's control to show a grade column to its students.
 *
 * A button that opens a confirmation saying how many students will see a
 * grade and that it cannot be undone; the page reloads once it succeeds.
 */
export default function ReleaseGradeColumn(
	props: ReleaseGradeColumnProps,
): JSX.Element {
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	let dialog: HTMLDialogElement | undefined;

	async function release(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.gradeColumn.release({
			discipline: props.discipline,
			course: props.course,
			slug: props.slug,
		});
		setBusy(false);
		dialog?.close();
		if (error) {
			setFailure(errorMessage(error));
			return;
		}
		window.location.reload();
	}

	return (
		<div class="mt-1 flex flex-col gap-1">
			<FormAlert error={failure() ?? undefined} class="text-xs font-normal" />

			<button
				type="button"
				class="btn btn-xs btn-outline self-start"
				onClick={() => dialog?.showModal()}
			>
				Release<span class="sr-only"> {props.title}</span>
			</button>

			<dialog ref={dialog} class="modal">
				<div class="modal-box whitespace-normal text-left font-normal text-base-content">
					<h3 class="text-lg font-bold">Release {props.title}?</h3>
					<p class="mt-2 text-sm text-base-content/70">
						{props.valued === 1
							? "1 student will see their grade."
							: `${props.valued} students will see their grade.`}{" "}
						You can't undo this once it is released.
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
							onClick={release}
						>
							Release
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
