import { actions } from "astro:actions";
import type { JSX } from "solid-js";
import { createSchemaForm } from "@/components/form/create-schema-form";
import Field from "@/components/form/Field";
import FormAlert from "@/components/form/FormAlert";
import { rollCallOpen } from "@/core/schemas";

export interface OpenRollCallDialogProps {
	/// The course's URL segments, as the roll call actions take them.
	discipline: string;
	course: string;
	/// The meeting's week and time slot slug.
	week: number;
	timeSlot: string;
	/// The course's base URL; the roll call page is `<href>/roll-call/<week>/<timeSlot>`.
	href: string;
	/// The opening button's text; "Roll call" by default.
	label?: string;
}

/**
 * A "Roll call" button that opens a dialog to start the meeting's roll call.
 *
 * The dialog asks whether the roll call counts as an invite, opens it and
 * sends the instructor to its management page.
 */
export default function OpenRollCallDialog(
	props: OpenRollCallDialogProps,
): JSX.Element {
	let dialog: HTMLDialogElement | undefined;
	const form = createSchemaForm(rollCallOpen, {
		id: `open-roll-call-${props.week}-${props.timeSlot}`,
		action: actions.rollCall.open,
		hidden: {
			discipline: props.discipline,
			course: props.course,
			week: String(props.week),
			timeSlot: props.timeSlot,
		},
		onSuccess: () => {
			window.location.href = `${props.href}/roll-call/${props.week}/${props.timeSlot}`;
		},
	});

	return (
		<>
			<button
				type="button"
				class="btn btn-outline btn-sm"
				onClick={() => dialog?.showModal()}
			>
				{props.label ?? "Roll call"}
			</button>
			<dialog ref={dialog} class="modal">
				<div class="modal-box">
					<h3 class="text-lg font-bold">Open the roll call</h3>
					<p class="mt-2 text-sm text-base-content/70">
						Students check in for 15 minutes with the code on the projected
						screen.
					</p>
					<form
						noValidate
						class="mt-4 flex flex-col gap-3"
						onSubmit={form.submit}
					>
						<FormAlert error={form.error()} />
						<Field {...form.field("actsAsInvite")} />
						<div class="modal-action">
							<button
								type="button"
								class="btn btn-ghost"
								disabled={form.busy()}
								onClick={() => dialog?.close()}
							>
								Cancel
							</button>
							<button
								type="submit"
								class="btn btn-primary"
								disabled={form.busy()}
							>
								Open roll call
							</button>
						</div>
					</form>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">close</button>
				</form>
			</dialog>
		</>
	);
}
