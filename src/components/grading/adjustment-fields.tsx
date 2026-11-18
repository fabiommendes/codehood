import { createSignal, For, type JSX, Show } from "solid-js";
import type { ExamAdjustmentOp } from "@/core/schemas/exam-adjustment";
import { m } from "@/i18n";

/// The three operations of a bonus, with the value each starts with.
export const BONUS_OPS: readonly {
	op: ExamAdjustmentOp;
	initial: string;
}[] = [
	{ op: "OFFSET", initial: "10" },
	{ op: "FACTOR", initial: "110" },
	{ op: "SET", initial: "100" },
];

/// The label of an operation in the segmented control.
export function opLabel(op: ExamAdjustmentOp): string {
	if (op === "OFFSET") return m.grades_adjustment_op_offset();
	return op === "FACTOR"
		? m.grades_adjustment_op_factor()
		: m.grades_adjustment_op_set();
}

/// The hint under the value of an operation.
export function opHint(op: ExamAdjustmentOp): string {
	if (op === "OFFSET") return m.grades_adjustment_hint_offset();
	return op === "FACTOR"
		? m.grades_adjustment_hint_factor()
		: m.grades_adjustment_hint_set();
}

/// The unit shown inside the value field of an operation.
export function opUnit(op: ExamAdjustmentOp): string {
	return op === "OFFSET" ? m.grades_adjustment_unit_points() : "%";
}

/// "from → to" in the same line, the new value in `tone`.
export function Preview(props: {
	from: string;
	to: string;
	tone: string;
}): JSX.Element {
	return (
		<p class="whitespace-nowrap text-sm tabular-nums">
			<span class="text-muted">{props.from}</span> →{" "}
			<strong class={props.tone}>{props.to}</strong>
		</p>
	);
}

/// A number field with its unit inside, the preview beside it and a hint below.
export function ValueField(props: {
	id: string;
	label: string;
	value: string;
	onInput: (text: string) => void;
	unit: string;
	hint: string;
	disabled?: boolean;
	preview?: JSX.Element;
	/// What sits at the end of the line, such as the "Zero" checkbox.
	end?: JSX.Element;
}): JSX.Element {
	return (
		<fieldset class="fieldset py-0">
			<div class="flex items-center gap-3">
				<label class="input input-sm w-40">
					<input
						id={props.id}
						type="text"
						inputmode="decimal"
						autocomplete="off"
						aria-label={props.label}
						value={props.value}
						disabled={props.disabled}
						onInput={(event) => props.onInput(event.currentTarget.value)}
					/>
					<span class="label">{props.unit}</span>
				</label>
				{props.preview}
				<div class="ml-auto">{props.end}</div>
			</div>
			<p class="label whitespace-normal">{props.hint}</p>
		</fieldset>
	);
}

/// The "Zero" checkbox of a sanction.
export function ZeroCheckbox(props: {
	checked: boolean;
	onChange: (checked: boolean) => void;
}): JSX.Element {
	return (
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-xs"
				checked={props.checked}
				onChange={(event) => props.onChange(event.currentTarget.checked)}
			/>
			{m.grades_adjustment_zero()}
		</label>
	);
}

/// The segmented control of the three bonus operations.
export function OpSwitch(props: {
	id: string;
	op: ExamAdjustmentOp;
	onChange: (op: ExamAdjustmentOp, initial: string) => void;
}): JSX.Element {
	return (
		<div
			class="join w-full"
			role="radiogroup"
			aria-label={m.grades_adjustment_op_label()}
		>
			<For each={BONUS_OPS}>
				{(entry) => (
					<input
						type="radio"
						name={`${props.id}-op`}
						class="btn btn-sm join-item flex-1"
						aria-label={opLabel(entry.op)}
						checked={props.op === entry.op}
						onChange={() => props.onChange(entry.op, entry.initial)}
					/>
				)}
			</For>
		</div>
	);
}

/// The reason the student reads, and a private note behind a link.
export function ReasonFields(props: {
	id: string;
	reason: string;
	onReason: (text: string) => void;
	note?: string;
	onNote?: (text: string) => void;
}): JSX.Element {
	const [showNote, setShowNote] = createSignal(Boolean(props.note));
	return (
		<>
			<fieldset class="fieldset py-0">
				<legend class="fieldset-legend py-0.5">
					<label for={`${props.id}-reason`}>
						{m.grades_adjustment_reason()}
					</label>
				</legend>
				<textarea
					id={`${props.id}-reason`}
					class="textarea textarea-sm w-full"
					rows={2}
					value={props.reason}
					onInput={(event) => props.onReason(event.currentTarget.value)}
				/>
			</fieldset>
			<Show when={props.onNote}>
				{(onNote) => (
					<Show
						when={showNote()}
						fallback={
							<button
								type="button"
								class="link link-hover self-start text-xs text-muted"
								onClick={() => setShowNote(true)}
							>
								{m.grades_adjustment_notes_add()}
							</button>
						}
					>
						<fieldset class="fieldset py-0">
							<legend class="fieldset-legend py-0.5">
								<label for={`${props.id}-note`}>
									{m.grades_adjustment_notes()}
								</label>
							</legend>
							<textarea
								id={`${props.id}-note`}
								class="textarea textarea-sm w-full"
								rows={2}
								placeholder={m.grades_adjustment_notes_hint()}
								value={props.note ?? ""}
								onInput={(event) => onNote()(event.currentTarget.value)}
							/>
						</fieldset>
					</Show>
				)}
			</Show>
		</>
	);
}

/// An error of the server, shown inside its dialog.
export function DialogError(props: { message?: string }): JSX.Element {
	return (
		<Show when={props.message}>
			<p role="alert" class="text-sm text-error">
				{props.message}
			</p>
		</Show>
	);
}
