import { actions } from "astro:actions";
import { createMemo, createSignal, For, type JSX, Show } from "solid-js";
import {
	type ExamAdjustmentOp,
	percentToFraction,
} from "@/core/schemas/exam-adjustment";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { formatScore } from "@/services/exam-result";
import {
	DialogError,
	OpSwitch,
	opHint,
	opUnit,
	Preview,
	ReasonFields,
	ValueField,
	ZeroCheckbox,
} from "./adjustment-fields";
import Dialog from "./Dialog";

/// What an adjustment of `op` and `fraction` does to a score, as the dialog previews it.
export type AdjustmentPreview = (change: {
	op: ExamAdjustmentOp;
	fraction: number;
}) => { from: number | null; to: number | null } | null;

export interface AdjustmentDialogProps {
	/// Unique in the page: names the dialog by its heading.
	id: string;
	open: boolean;
	onClose: () => void;
	/// The course's URL segments and the exam slug, as the adjustment action takes them.
	discipline: string;
	course: string;
	exam: string;
	/// The students to adjust, by username; the dialog asks for them when absent.
	usernames?: readonly string[];
	/// Tells how many students the dialog will adjust.
	showCount?: boolean;
	/// `bonus` offers the three operations, `sanction` only keeps a share of the grade, `any` leaves the target to the form.
	kind: "bonus" | "sanction" | "any";
	/// The exam's questions, offered as targets next to the whole exam, with `kind` `any`.
	questions?: readonly { slug: string; title: string }[];
	/// Fixes the target to this question, whose grade is kept in part.
	question?: string;
	title: string;
	submitLabel: string;
	preview?: AdjustmentPreview;
}

/// The usernames in free text, separated by spaces, commas or lines.
function usernamesOf(text: string): string[] {
	return text.split(/[\s,]+/).filter(Boolean);
}

/// The text as a number of the stored fraction, or `null` when it is not a number.
function fractionOf(text: string): number | null {
	const fraction = Number(percentToFraction(text));
	return text.trim() === "" || !Number.isFinite(fraction) ? null : fraction;
}

/**
 * A compact dialog that adjusts students on the whole exam or on one question: an operation, a value, the reason the student reads and, optionally, a private note.
 *
 * The page reloads once the adjustment is saved; a refusal of the server shows in the dialog.
 */
export default function AdjustmentDialog(
	props: AdjustmentDialogProps,
): JSX.Element {
	const [target, setTarget] = createSignal(props.question ?? "");
	const [typed, setTyped] = createSignal("");
	const [op, setOp] = createSignal<ExamAdjustmentOp>(
		props.kind === "bonus" ? "OFFSET" : "FACTOR",
	);
	const [value, setValue] = createSignal(props.kind === "bonus" ? "10" : "50");
	const [zero, setZero] = createSignal(false);
	const [reason, setReason] = createSignal("");
	const [note, setNote] = createSignal("");
	const [error, setError] = createSignal<string>();
	const [busy, setBusy] = createSignal(false);

	/// Whether the target is a question, which only a share of the grade can hit.
	const onQuestion = () => target() !== "";
	/// Whether the form keeps a share of the grade instead of offering the three operations.
	const keeping = () => props.kind === "sanction" || onQuestion();
	const effectiveOp = (): ExamAdjustmentOp => (keeping() ? "FACTOR" : op());
	const effectiveValue = () => (keeping() && zero() ? "0" : value());
	const usernames = () => [...(props.usernames ?? usernamesOf(typed()))];

	const preview = createMemo(() => {
		const fraction = fractionOf(effectiveValue());
		if (!props.preview || fraction === null) return null;
		return props.preview({ op: effectiveOp(), fraction });
	});
	const label = (score: number | null) =>
		score === null ? m.grades_adjustment_total_pending() : formatScore(score);

	async function submit(): Promise<void> {
		if (fractionOf(effectiveValue()) === null) {
			setError(m.grades_adjustment_form_error());
			return;
		}
		setBusy(true);
		setError(undefined);
		const { error: failure } = await actions.examAdjustment.create({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			usernames: usernames(),
			...(onQuestion() ? { question: target() } : {}),
			op: effectiveOp(),
			value: effectiveValue().trim(),
			reason: reason(),
			notes: note(),
		});
		if (failure) {
			setError(errorMessage(failure));
			setBusy(false);
			return;
		}
		window.location.reload();
	}

	return (
		<Dialog
			id={props.id}
			title={props.title}
			size="max-w-md"
			open={props.open}
			onClose={props.onClose}
			action={{
				label: props.submitLabel,
				tone: props.kind === "bonus" ? "btn-primary" : "btn-error",
				onClick: () => void submit(),
				disabled: busy(),
			}}
		>
			<div class="flex flex-col gap-3">
				<DialogError message={error()} />
				<Show when={props.usernames === undefined}>
					<fieldset class="fieldset py-0">
						<legend class="fieldset-legend py-0.5">
							<label for={`${props.id}-usernames`}>
								{m.grades_adjustment_usernames()}
							</label>
						</legend>
						<textarea
							id={`${props.id}-usernames`}
							class="textarea textarea-sm w-full font-mono"
							rows={2}
							value={typed()}
							onInput={(event) => setTyped(event.currentTarget.value)}
						/>
						<p class="label whitespace-normal">
							{m.grades_adjustment_usernames_hint()}
						</p>
					</fieldset>
				</Show>
				<Show when={props.showCount}>
					<p class="text-sm text-base-content/70">
						{m.grades_adjustment_students_selected({
							count: props.usernames?.length ?? 0,
						})}
					</p>
				</Show>
				<Show when={props.kind === "any" && props.question === undefined}>
					<fieldset class="fieldset py-0">
						<legend class="fieldset-legend py-0.5">
							<label for={`${props.id}-target`}>
								{m.grades_adjustment_target()}
							</label>
						</legend>
						<select
							id={`${props.id}-target`}
							class="select select-sm w-full"
							value={target()}
							onChange={(event) => {
								setTarget(event.currentTarget.value);
								setZero(false);
							}}
						>
							<option value="">{m.grades_adjustment_target_exam()}</option>
							<For each={props.questions}>
								{(question) => (
									<option value={question.slug}>{question.title}</option>
								)}
							</For>
						</select>
					</fieldset>
				</Show>
				<Show
					when={keeping()}
					fallback={
						<>
							<OpSwitch
								id={props.id}
								op={op()}
								onChange={(next, initial) => {
									setOp(next);
									setValue(initial);
								}}
							/>
							<ValueField
								id={`${props.id}-value`}
								label={m.grades_adjustment_value()}
								value={value()}
								onInput={setValue}
								unit={opUnit(op())}
								hint={opHint(op())}
								preview={
									<Show when={preview()}>
										{(shown) => (
											<Preview
												from={label(shown().from)}
												to={label(shown().to)}
												tone="text-success"
											/>
										)}
									</Show>
								}
							/>
						</>
					}
				>
					<ValueField
						id={`${props.id}-value`}
						label={m.grades_adjustment_kept()}
						value={zero() ? "0" : value()}
						onInput={setValue}
						unit="%"
						disabled={zero()}
						hint={
							onQuestion()
								? m.grades_adjustment_kept_hint_question()
								: m.grades_adjustment_kept_hint_exam()
						}
						preview={
							<Show when={preview()}>
								{(shown) => (
									<Preview
										from={label(shown().from)}
										to={label(shown().to)}
										tone="text-error"
									/>
								)}
							</Show>
						}
						end={<ZeroCheckbox checked={zero()} onChange={setZero} />}
					/>
				</Show>
				<ReasonFields
					id={props.id}
					reason={reason()}
					onReason={setReason}
					note={note()}
					onNote={setNote}
				/>
			</div>
		</Dialog>
	);
}
