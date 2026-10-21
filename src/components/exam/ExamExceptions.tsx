import { actions } from "astro:actions";
import { createSignal, For, type JSX, Show } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { examExceptionSave } from "@/core/schemas";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";

/// One exception as the table shows it, with the values the edit dialog starts from.
export interface ExceptionRow {
	username: string;
	name: string;
	/// The extra time as "+90 min", or `null` when the exception grants none.
	extra: string | null;
	/// The new date, formatted, or `null` when the exam's own date stands.
	date: string | null;
	/// The student's personal window, formatted, or `null` when it has no end.
	window: string | null;
	note: string | null;
	extraMinutes: number | null;
	/// The new date as a `datetime-local` value, or `null`.
	scheduledLocal: string | null;
}

export interface ExamExceptionsProps {
	/// The course's URL segments and the exam slug, as the exam actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// The students an exception may be granted to.
	students: { username: string; name: string }[];
	rows: ExceptionRow[];
}

/**
 * The instructor's table of an exam's exceptions, with dialogs to add, edit and remove one.
 *
 * Every change reloads the page, which recomputes the windows and the release
 * control from the server.
 */
export default function ExamExceptions(
	props: ExamExceptionsProps,
): JSX.Element {
	let dialog: HTMLDialogElement | undefined;
	let formElement: HTMLFormElement | undefined;
	let removeDialog: HTMLDialogElement | undefined;
	const [editing, setEditing] = createSignal(false);
	/// The student whose exception the dialog edits; a disabled select cannot submit it, so a hidden field does.
	const [editedUser, setEditedUser] = createSignal("");
	let studentSelect: HTMLSelectElement | undefined;
	const [removing, setRemoving] = createSignal<ExceptionRow | null>(null);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);

	const form = createSchemaForm(examExceptionSave, {
		id: "exam-exception",
		action: actions.exam.saveException,
		hidden: {
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
		},
		onSuccess: () => window.location.reload(),
	});

	/// Fills the form controls and tells the form state about the new values.
	function fill(values: Record<string, string>): void {
		if (!formElement) return;
		formElement.reset();
		for (const [name, value] of Object.entries(values)) {
			const control = formElement.elements.namedItem(name);
			if (control instanceof HTMLInputElement) control.value = value;
			if (control instanceof HTMLSelectElement) control.value = value;
		}
		if (studentSelect) studentSelect.value = values.username ?? "";
		formElement.elements
			.item(0)
			?.dispatchEvent(new InputEvent("input", { bubbles: true }));
	}

	function openAdd(): void {
		setEditing(false);
		setEditedUser("");
		fill({});
		dialog?.showModal();
	}

	function openEdit(row: ExceptionRow): void {
		setEditing(true);
		setEditedUser(row.username);
		fill({
			username: row.username,
			extraMinutes: row.extraMinutes ? String(row.extraMinutes) : "",
			scheduledAt: row.scheduledLocal ?? "",
			note: row.note ?? "",
		});
		dialog?.showModal();
	}

	function openRemove(row: ExceptionRow): void {
		setFailure(null);
		setRemoving(row);
		removeDialog?.showModal();
	}

	async function remove(): Promise<void> {
		const row = removing();
		if (!row) return;
		setBusy(true);
		const { error } = await actions.exam.removeException({
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
			username: row.username,
		});
		if (error) {
			setBusy(false);
			setFailure(errorMessage(error));
			return;
		}
		window.location.reload();
	}

	const student = () => form.field("username");

	return (
		<div class="flex flex-col gap-4">
			<Show
				when={props.rows.length > 0}
				fallback={
					<p class="text-sm text-base-content/60">
						{m.exams_exceptions_empty()}
					</p>
				}
			>
				<div class="overflow-x-auto rounded-box border border-base-300 bg-base-100">
					<table class="table">
						<thead>
							<tr>
								<th>{m.exams_exceptions_col_student()}</th>
								<th>{m.exams_exceptions_col_extra()}</th>
								<th>{m.exams_exceptions_col_date()}</th>
								<th>{m.exams_exceptions_col_window()}</th>
								<th>{m.exams_exceptions_col_note()}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							<For each={props.rows}>
								{(row) => (
									<tr>
										<td class="font-medium">{row.name}</td>
										<td>{row.extra}</td>
										<td>{row.date}</td>
										<td>{row.window}</td>
										<td>{row.note}</td>
										<td class="flex justify-end gap-2">
											<button
												type="button"
												class="btn btn-ghost btn-sm"
												onClick={() => openEdit(row)}
											>
												{m.exams_exceptions_edit()}
											</button>
											<button
												type="button"
												class="btn btn-ghost btn-sm text-error"
												onClick={() => openRemove(row)}
											>
												{m.exams_exceptions_remove()}
											</button>
										</td>
									</tr>
								)}
							</For>
						</tbody>
					</table>
				</div>
			</Show>

			<div>
				<button type="button" class="btn btn-primary btn-sm" onClick={openAdd}>
					{m.exams_exceptions_add()}
				</button>
			</div>

			<dialog ref={dialog} class="modal">
				<div class="modal-box">
					<h3 class="text-lg font-bold">
						{editing()
							? m.exams_exceptions_edit_title()
							: m.exams_exceptions_add_title()}
					</h3>
					<form
						ref={formElement}
						noValidate
						class="mt-4 flex flex-col gap-3"
						onSubmit={form.submit}
					>
						<FormAlert error={form.error()} />
						<fieldset class="fieldset">
							<legend class="fieldset-legend">
								<label for={student().id}>{student().label}</label>
							</legend>
							<Show when={editing()}>
								<input type="hidden" name="username" value={editedUser()} />
							</Show>
							<select
								ref={studentSelect}
								id={student().id}
								name={editing() ? undefined : "username"}
								class="select w-full"
								required
								disabled={editing()}
								onInput={student().onInput}
							>
								<option value="">{m.exams_exceptions_select_student()}</option>
								<For each={props.students}>
									{(entry) => (
										<option value={entry.username}>{entry.name}</option>
									)}
								</For>
							</select>
							<For each={student().errors}>
								{(message) => (
									<p role="alert" class="label whitespace-normal text-error">
										{message}
									</p>
								)}
							</For>
						</fieldset>
						<Field {...form.field("extraMinutes")} />
						<Field {...form.field("scheduledAt")} />
						<Field {...form.field("note")} />
						<div class="modal-action">
							<button
								type="button"
								class="btn btn-ghost"
								disabled={form.busy()}
								onClick={() => dialog?.close()}
							>
								{m.exams_cancel()}
							</button>
							<button
								type="submit"
								class="btn btn-primary"
								disabled={form.busy()}
							>
								{m.exams_exceptions_save()}
							</button>
						</div>
					</form>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">{m.exams_close_backdrop()}</button>
				</form>
			</dialog>

			<dialog ref={removeDialog} class="modal">
				<div class="modal-box">
					<h3 class="text-lg font-bold">{m.exams_exceptions_remove_title()}</h3>
					<p class="mt-2 text-sm text-base-content/70">
						{m.exams_exceptions_remove_body({ name: removing()?.name ?? "" })}
					</p>
					<FormAlert error={failure() ?? undefined} class="mt-3" />
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							disabled={busy()}
							onClick={() => removeDialog?.close()}
						>
							{m.exams_cancel()}
						</button>
						<button
							type="button"
							class="btn btn-error"
							disabled={busy()}
							onClick={remove}
						>
							{m.exams_exceptions_remove()}
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
