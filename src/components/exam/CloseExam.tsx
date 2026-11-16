import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";

export interface CloseExamProps {
	/// The course's URL segments and the exam slug, as the exam actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// Attempts still taking answers.
	inProgress: number;
	/// Whether the exam has no end date: it stays open until the instructor closes it.
	noDeadline: boolean;
}

/**
 * The instructor's control to end an open exam now.
 *
 * Warns when the exam has no deadline, and asks for a confirmation that says
 * how many attempts in progress the closing ends.
 */
export default function CloseExam(props: CloseExamProps): JSX.Element {
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	let dialog: HTMLDialogElement | undefined;

	async function close(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.exam.close({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
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
		<div class="flex flex-col gap-3">
			<FormAlert error={failure() ?? undefined} />

			<Show when={props.noDeadline}>
				<p role="status" class="alert alert-warning" data-testid="no-deadline">
					{m.exams_close_no_deadline({ count: props.inProgress })}
				</p>
			</Show>

			<div>
				<button
					type="button"
					class="btn btn-outline"
					onClick={() => dialog?.showModal()}
				>
					{m.exams_close_button()}
				</button>
			</div>

			<dialog ref={dialog} class="modal">
				<div class="modal-box">
					<h3 class="text-lg font-bold">{m.exams_close_title()}</h3>
					<p class="mt-2 text-sm text-base-content/70">
						{m.exams_close_body({ count: props.inProgress })}
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
							onClick={close}
						>
							{m.exams_close_button()}
						</button>
					</div>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">{m.exams_close_backdrop()}</button>
				</form>
			</dialog>
		</div>
	);
}
