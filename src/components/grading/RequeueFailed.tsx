import { actions } from "astro:actions";
import { createSignal, type JSX } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";

export interface RequeueFailedProps {
	/// The course's URL segments, the exam and the question, as the grading actions take them.
	discipline: string;
	course: string;
	exam: string;
	question: string;
}

/** A "Requeue failures" button that puts the failed grading jobs of the question back in the queue and reloads the page. */
export default function RequeueFailed(props: RequeueFailedProps): JSX.Element {
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);

	async function requeue(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.gradingJob.requeueFailed(props);
		if (error) {
			setBusy(false);
			setFailure(errorMessage(error));
			return;
		}
		window.location.reload();
	}

	return (
		<div class="flex flex-col gap-2">
			<FormAlert error={failure() ?? undefined} />
			<div>
				<button
					type="button"
					class="btn btn-outline btn-sm"
					data-action="requeue-failed"
					disabled={busy()}
					onClick={requeue}
				>
					{busy()
						? m.grades_code_queue_requeueing()
						: m.grades_code_queue_requeue()}
				</button>
			</div>
		</div>
	);
}
