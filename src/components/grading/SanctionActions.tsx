import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { examSanctionRevokeForm, examSanctionUpdateForm } from "@/core/schemas";
import { m } from "@/i18n";
import SanctionModal from "./SanctionModal";
import { withInitialValues } from "./sanction-fields";

export interface SanctionActionsProps {
	/// The course's URL segments and the exam slug, as the sanction actions take them.
	discipline: string;
	course: string;
	exam: string;
	/// The `publicId` of the active sanction.
	sanction: string;
	/// The sanction's `updatedAt` as ISO text, the version the page loaded.
	updatedAt: string;
	/// Whether the sanction hits the whole exam, the only target whose factor can change.
	wholeExam: boolean;
	factor: string;
	reason: string | null;
	notes: string | null;
}

/**
 * The buttons of an active sanction: "Edit" for its factor, reason and notes, and "Revoke", after a confirmation.
 *
 * The page reloads once either one succeeds.
 */
export default function SanctionActions(
	props: SanctionActionsProps,
): JSX.Element {
	const id = props.sanction;
	const [editing, setEditing] = createSignal(false);
	const [revoking, setRevoking] = createSignal(false);
	const target = {
		discipline: props.discipline,
		course: props.course,
		exam: props.exam,
		sanction: props.sanction,
		updatedAt: props.updatedAt,
	};
	const edit = createSchemaForm(examSanctionUpdateForm, {
		id: `edit-${id}`,
		action: actions.examSanction.update,
		hidden: target,
		fields: {
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
	const field = withInitialValues(edit, {
		factor: props.factor,
		reason: props.reason ?? "",
		notes: props.notes ?? "",
	});
	const revoke = createSchemaForm(examSanctionRevokeForm, {
		id: `revoke-${id}`,
		action: actions.examSanction.revoke,
		hidden: target,
		onSuccess: () => window.location.reload(),
	});

	return (
		<div class="flex justify-end gap-1">
			<button
				type="button"
				class="btn btn-square btn-ghost btn-sm"
				aria-label={m.grades_sanction_edit_button()}
				title={m.grades_sanction_edit_button()}
				onClick={() => setEditing(true)}
			>
				<svg
					aria-hidden="true"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
				>
					<path
						d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4Zm9-13 4 4"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<button
				type="button"
				class="btn btn-square btn-ghost btn-sm text-error"
				aria-label={m.grades_sanction_revoke_button()}
				title={m.grades_sanction_revoke_button()}
				onClick={() => setRevoking(true)}
			>
				<svg
					aria-hidden="true"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
				>
					<path
						d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>

			<SanctionModal
				id={`edit-${id}`}
				title={m.grades_sanction_edit_title()}
				open={editing()}
				onClose={() => setEditing(false)}
			>
				<form
					noValidate
					class="mt-2 flex flex-col gap-1"
					onSubmit={edit.submit}
				>
					<FormAlert error={edit.error()} />
					<Show when={props.wholeExam}>
						<Field
							{...field("factor")}
							control={{ inputmode: "decimal", autocomplete: "off" }}
						/>
					</Show>
					<Field {...field("reason")} />
					<Field {...field("notes")} />
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							disabled={edit.busy()}
							onClick={() => setEditing(false)}
						>
							{m.grades_cancel()}
						</button>
						<button
							type="submit"
							class="btn btn-primary"
							disabled={edit.busy()}
						>
							{m.grades_sanction_save()}
						</button>
					</div>
				</form>
			</SanctionModal>

			<SanctionModal
				id={`revoke-${id}`}
				title={m.grades_sanction_revoke_title()}
				open={revoking()}
				onClose={() => setRevoking(false)}
			>
				<form noValidate class="mt-2" onSubmit={revoke.submit}>
					<FormAlert error={revoke.error()} />
					<p class="text-sm text-base-content/70">
						{m.grades_sanction_revoke_body()}
					</p>
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							disabled={revoke.busy()}
							onClick={() => setRevoking(false)}
						>
							{m.grades_cancel()}
						</button>
						<button
							type="submit"
							class="btn btn-error"
							disabled={revoke.busy()}
						>
							{m.grades_sanction_revoke_title()}
						</button>
					</div>
				</form>
			</SanctionModal>
		</div>
	);
}
