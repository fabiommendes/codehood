import { actions } from "astro:actions";
import { createSignal, For, type JSX, Show } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { examSanctionCreateForm } from "@/core/schemas";
import { m } from "@/i18n";
import SanctionModal from "./SanctionModal";
import { withInitialValues } from "./sanction-fields";

export interface SanctionDialogProps {
	/// The course's URL segments and the exam slug, as the sanction action takes them.
	discipline: string;
	course: string;
	exam: string;
	/// The students to sanction, by username.
	usernames: readonly string[];
	/// The exam's questions, offered as targets next to the whole exam.
	questions?: readonly { slug: string; title: string }[];
	/// Fixes the target to this question, hiding the target and the factor: a question is zeroed, never reduced.
	question?: string;
	/// Tells how many students the dialog will sanction.
	showCount?: boolean;
	/// Text of the button that opens the dialog.
	triggerLabel: string;
	triggerClass?: string;
	/// Disables the button that opens the dialog.
	disabled?: boolean;
	/// Heading of the dialog.
	title: string;
	/// Text of the dialog's submit button.
	submitLabel: string;
}

/**
 * A button that opens the dialog to sanction students on the whole exam or on one question.
 *
 * The factor, a share of the score that stays, is asked for the whole exam
 * only. The page reloads once the sanctions are saved.
 */
export default function SanctionDialog(
	props: SanctionDialogProps,
): JSX.Element {
	/// One dialog per target on a page: the whole exam or one question.
	const id = `sanction-${props.question ?? "exam"}`;
	const [open, setOpen] = createSignal(false);
	/// The question picked in the target field; empty is the whole exam.
	const [target, setTarget] = createSignal("");
	const form = createSchemaForm(examSanctionCreateForm, {
		id,
		action: actions.examSanction.create,
		hidden: {
			discipline: props.discipline,
			course: props.course,
			exam: props.exam,
		},
		fields: {
			question: { label: m.grades_sanction_target() },
			factor: {
				label: m.grades_sanction_factor(),
				hint: m.grades_sanction_factor_hint(),
			},
			reason: {
				label: m.grades_sanction_reason(),
				hint: m.grades_sanction_reason_hint(),
			},
			notes: {
				label: m.grades_sanction_notes(),
				hint: m.grades_sanction_notes_hint(),
				widget: "textarea",
			},
		},
		onSuccess: () => window.location.reload(),
	});
	const field = withInitialValues(form, { factor: "0" });

	return (
		<>
			<button
				type="button"
				class={props.triggerClass ?? "btn btn-outline btn-sm"}
				disabled={props.disabled}
				onClick={() => setOpen(true)}
			>
				{props.triggerLabel}
			</button>
			<SanctionModal
				id={id}
				title={props.title}
				open={open()}
				onClose={() => setOpen(false)}
			>
				<form
					noValidate
					class="mt-2 flex flex-col gap-1"
					onSubmit={form.submit}
				>
					<For each={props.usernames}>
						{(username) => (
							<input type="hidden" name="usernames" value={username} />
						)}
					</For>
					<Show when={props.showCount}>
						<p class="text-sm text-base-content/70">
							{m.grades_sanction_students_selected({
								count: props.usernames.length,
							})}
						</p>
					</Show>
					<FormAlert error={form.error()} />
					<Show
						when={props.question === undefined}
						fallback={
							<input type="hidden" name="question" value={props.question} />
						}
					>
						<fieldset class="fieldset">
							<legend class="fieldset-legend">
								<label for={`${id}-question`}>
									{m.grades_sanction_target()}
								</label>
							</legend>
							<select
								id={`${id}-question`}
								name="question"
								class="select w-full"
								value={target()}
								onChange={(event) => setTarget(event.currentTarget.value)}
							>
								<option value="">{m.grades_sanction_target_exam()}</option>
								<For each={props.questions}>
									{(question) => (
										<option value={question.slug}>{question.title}</option>
									)}
								</For>
							</select>
							<For each={field("question").errors}>
								{(message) => (
									<p class="text-sm text-error" role="alert">
										{message}
									</p>
								)}
							</For>
						</fieldset>
						<Show when={target() === ""}>
							<Field
								{...field("factor")}
								control={{ inputmode: "decimal", autocomplete: "off" }}
							/>
						</Show>
					</Show>
					<Field {...field("reason")} />
					<Field {...field("notes")} />
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							disabled={form.busy()}
							onClick={() => setOpen(false)}
						>
							{m.grades_cancel()}
						</button>
						<button
							type="submit"
							class="btn btn-primary"
							disabled={form.busy()}
						>
							{props.submitLabel}
						</button>
					</div>
				</form>
			</SanctionModal>
		</>
	);
}
