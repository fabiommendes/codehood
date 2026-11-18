import { actions } from "astro:actions";
import { createSignal, type JSX } from "solid-js";
import {
	type ExamAdjustmentOp,
	fractionToPercent,
} from "@/core/schemas/exam-adjustment";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import {
	DialogError,
	opHint,
	opUnit,
	ReasonFields,
	ValueField,
} from "./adjustment-fields";
import Dialog from "./Dialog";
import Icon from "./Icon";

export interface AdjustmentActionsProps {
	/// The course's URL segments and the exam slug, as the adjustment actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// The `publicId` of the active adjustment.
	adjustment: string;
	/// The adjustment's `updatedAt` as ISO text, the version the page loaded.
	updatedAt: string;
	op: ExamAdjustmentOp;
	/// The adjustment's value, a fraction as stored.
	value: string;
	reason: string | null;
	notes: string | null;
	/// Whether the adjustment hits a question, whose value is the share of the grade kept.
	onQuestion?: boolean;
}

/**
 * The buttons of an active adjustment: "Edit" for its value, reason and note, and "Revoke", after a confirmation.
 *
 * The page reloads once either one succeeds.
 */
export default function AdjustmentActions(
	props: AdjustmentActionsProps,
): JSX.Element {
	const id = `adjustment-${props.adjustment}`;
	const [editing, setEditing] = createSignal(false);
	const [revoking, setRevoking] = createSignal(false);
	const [value, setValue] = createSignal(fractionToPercent(props.value));
	const [reason, setReason] = createSignal(props.reason ?? "");
	const [note, setNote] = createSignal(props.notes ?? "");
	const [error, setError] = createSignal<string>();
	const [busy, setBusy] = createSignal(false);
	const target = {
		discipline: props.discipline,
		course: props.course,
		exam: props.exam,
		adjustment: props.adjustment,
		updatedAt: props.updatedAt,
	};

	/// Runs `call`, reloading the page on success and showing the refusal otherwise.
	async function run(
		call: () => Promise<{ error?: Parameters<typeof errorMessage>[0] }>,
	): Promise<void> {
		setBusy(true);
		setError(undefined);
		const { error: failure } = await call();
		if (failure) {
			setError(errorMessage(failure));
			setBusy(false);
			return;
		}
		window.location.reload();
	}

	return (
		<div class="flex justify-end gap-1">
			<button
				type="button"
				class="btn btn-square btn-ghost btn-sm"
				aria-label={m.grades_adjustment_edit_button()}
				title={m.grades_adjustment_edit_button()}
				onClick={() => {
					setError(undefined);
					setEditing(true);
				}}
			>
				<Icon name="pencil" />
			</button>
			<button
				type="button"
				class="btn btn-square btn-ghost btn-sm text-error"
				aria-label={m.grades_adjustment_revoke_button()}
				title={m.grades_adjustment_revoke_button()}
				onClick={() => {
					setError(undefined);
					setRevoking(true);
				}}
			>
				<Icon name="trash2" />
			</button>

			<Dialog
				id={`edit-${id}`}
				title={m.grades_adjustment_edit_title()}
				size="max-w-md"
				open={editing()}
				onClose={() => setEditing(false)}
				action={{
					label: m.grades_adjustment_save(),
					tone: "btn-primary",
					disabled: busy(),
					onClick: () =>
						void run(() =>
							actions.examAdjustment.update({
								...target,
								value: value().trim() || undefined,
								reason: reason(),
								notes: note(),
							}),
						),
				}}
			>
				<div class="flex flex-col gap-3 text-left">
					<DialogError message={error()} />
					<ValueField
						id={`edit-${id}-value`}
						label={
							props.onQuestion
								? m.grades_adjustment_kept()
								: m.grades_adjustment_value()
						}
						value={value()}
						onInput={setValue}
						unit={props.onQuestion ? "%" : opUnit(props.op)}
						hint={
							props.onQuestion
								? m.grades_adjustment_kept_hint_question()
								: opHint(props.op)
						}
					/>
					<ReasonFields
						id={`edit-${id}`}
						reason={reason()}
						onReason={setReason}
						note={note()}
						onNote={setNote}
					/>
				</div>
			</Dialog>

			<Dialog
				id={`revoke-${id}`}
				title={m.grades_adjustment_revoke_title()}
				size="max-w-md"
				open={revoking()}
				onClose={() => setRevoking(false)}
				action={{
					label: m.grades_adjustment_revoke_title(),
					tone: "btn-error",
					disabled: busy(),
					onClick: () => void run(() => actions.examAdjustment.revoke(target)),
				}}
			>
				<div class="flex flex-col gap-3 text-left">
					<DialogError message={error()} />
					<p class="text-sm text-base-content/70">
						{m.grades_adjustment_revoke_body()}
					</p>
				</div>
			</Dialog>
		</div>
	);
}
