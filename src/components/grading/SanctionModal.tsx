import { createEffect, type JSX } from "solid-js";
import { m } from "@/i18n";

export interface SanctionModalProps {
	/// Unique in the page: names the dialog by its heading.
	id: string;
	title: string;
	/// Whether the dialog is open.
	open: boolean;
	/// Called when the dialog closes by itself (Escape, backdrop).
	onClose: () => void;
	children: JSX.Element;
}

/**
 * A DaisyUI modal that follows `open` and reports back when the browser closes it.
 */
export default function SanctionModal(props: SanctionModalProps): JSX.Element {
	let dialog: HTMLDialogElement | undefined;

	createEffect(() => {
		if (!dialog) return;
		if (props.open && !dialog.open) dialog.showModal();
		else if (!props.open && dialog.open) dialog.close();
	});

	return (
		<dialog
			ref={dialog}
			class="modal"
			aria-labelledby={`${props.id}-title`}
			onClose={() => props.onClose()}
		>
			<div class="modal-box whitespace-normal text-left font-normal text-base-content">
				<h3 id={`${props.id}-title`} class="text-lg font-bold">
					{props.title}
				</h3>
				{props.children}
			</div>
			<form method="dialog" class="modal-backdrop">
				<button type="submit">{m.grades_close_backdrop()}</button>
			</form>
		</dialog>
	);
}
