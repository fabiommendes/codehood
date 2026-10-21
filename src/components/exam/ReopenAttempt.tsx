import { actions } from "astro:actions";
import { createSignal, type JSX } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";

export interface ReopenAttemptProps {
	/// The course's URL segments, the exam slug and the student, as the exam actions take them.
	discipline: string;
	course: string;
	exam: string;
	username: string;
}

/** A "Reopen attempt" button that lets one student answer again and reloads the page. */
export default function ReopenAttempt(props: ReopenAttemptProps): JSX.Element {
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);

	async function reopen(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.exam.reopenAttempt(props);
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
					class="btn btn-primary btn-sm"
					disabled={busy()}
					onClick={reopen}
				>
					{m.exams_attempt_reopen()}
				</button>
			</div>
		</div>
	);
}
