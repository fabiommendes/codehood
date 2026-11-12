import { actions } from "astro:actions";
import { createSignal, type JSX } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";

export interface AnswerHistorySwitchProps {
	/// The course's URL segments and the exam slug, as the exam actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// The effective value when the page rendered.
	enabled: boolean;
}

/**
 * The instructor's switch for recording the edit history of an exam.
 *
 * Shows the effective value and stores an explicit one on each change; the
 * switch goes back to its previous position when the server refuses.
 */
export default function AnswerHistorySwitch(
	props: AnswerHistorySwitchProps,
): JSX.Element {
	const [enabled, setEnabled] = createSignal(props.enabled);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);

	async function change(next: boolean): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { data, error } = await actions.exam.setAnswerHistory({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			enabled: next,
		});
		setBusy(false);
		if (error) {
			setFailure(errorMessage(error));
			return;
		}
		setEnabled(data.answerHistory);
	}

	return (
		<div class="flex flex-col gap-2" data-testid="answer-history-setting">
			<FormAlert error={failure() ?? undefined} />
			<label class="flex cursor-pointer items-center gap-3">
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={enabled()}
					disabled={busy()}
					onChange={(event) => {
						const input = event.currentTarget;
						// The checkbox follows the server's answer, not the click.
						input.checked = enabled();
						void change(!enabled());
					}}
				/>
				<span class="text-sm font-medium">
					{m.exams_answer_history_label()}
				</span>
			</label>
			<p class="text-sm text-muted">{m.exams_answer_history_hint()}</p>
		</div>
	);
}
