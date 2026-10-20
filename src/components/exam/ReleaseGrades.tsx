import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { formatRelative } from "@/utils/relative-time";
import { formatDateTime } from "@/utils/schedule-time";

export interface ReleaseGradesProps {
	/// The course's URL segments and the exam slug, as the exam actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// When the grades were released, or `null` when they were not.
	releasedAt: Date | null;
	/// Whether the exam is closed with nothing left to grade, so releasing makes sense.
	canRelease: boolean;
	/// Server time when the page rendered.
	now: Date;
}

/**
 * The instructor's control over when students see their grades.
 *
 * Shows when the grades were released, or offers "Release results" behind a
 * confirmation that says what students will see and that it cannot be undone.
 */
export default function ReleaseGrades(props: ReleaseGradesProps): JSX.Element {
	const [releasedAt, setReleasedAt] = createSignal(props.releasedAt);
	const [reference, setReference] = createSignal(props.now);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	let dialog: HTMLDialogElement | undefined;

	async function release(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { data, error } = await actions.exam.releaseGrades({
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
		setReference(new Date());
		setReleasedAt(data.releasedAt ?? new Date());
	}

	return (
		<div class="flex flex-col gap-2">
			<FormAlert error={failure() ?? undefined} />

			<Show
				when={releasedAt()}
				fallback={
					<Show when={props.canRelease}>
						<div>
							<button
								type="button"
								class="btn btn-primary"
								onClick={() => dialog?.showModal()}
							>
								{m.exams_release_button()}
							</button>
						</div>
					</Show>
				}
			>
				{(date) => (
					<p class="text-sm text-base-content/70">
						<span title={formatDateTime(date(), { year: "numeric" })}>
							{m.exams_release_released({
								when: formatRelative(date(), reference()),
							})}
						</span>
					</p>
				)}
			</Show>

			<dialog ref={dialog} class="modal">
				<div class="modal-box">
					<h3 class="text-lg font-bold">{m.exams_release_title()}</h3>
					<p class="mt-2 text-sm text-base-content/70">
						{m.exams_release_body()}
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
							onClick={release}
						>
							{m.exams_release_button()}
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
