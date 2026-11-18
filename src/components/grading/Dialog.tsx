import { createEffect, type JSX } from "solid-js";
import { m } from "@/i18n";
import Icon from "./Icon";

interface Props {
	/// Unique in the page: names the dialog by its heading.
	id: string;
	title: JSX.Element;
	open: boolean;
	/// Called when the dialog closes by itself (Escape, backdrop, button).
	onClose: () => void;
	children: JSX.Element;
	/// Width class of the box; defaults to a wide one.
	size?: string;
	/// Primary action; when given the footer is Cancel on the left and this on the right.
	action?: {
		label: string;
		tone: "btn-primary" | "btn-error";
		onClick: () => void;
		disabled?: boolean;
	};
}

/**
 * A wide DaisyUI modal on a `<dialog>` that follows `open`.
 */
export default function Dialog(props: Props): JSX.Element {
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
			<div
				class={`modal-box ${props.size ?? "max-w-4xl"} whitespace-normal text-left font-normal text-base-content`}
			>
				<h3 id={`${props.id}-title`} class="text-lg font-bold">
					{props.title}
				</h3>
				<div class="mt-4">{props.children}</div>
				<div class="modal-action">
					<form
						method="dialog"
						class={props.action ? "flex w-full justify-between" : undefined}
					>
						<button
							type="submit"
							class={props.action ? "btn btn-ghost btn-sm" : "btn btn-sm"}
						>
							{props.action
								? m.grades_objective_cancel()
								: m.grades_objective_close()}
						</button>
						{props.action && (
							<button
								type="button"
								class={`btn btn-sm ${props.action.tone}`}
								disabled={props.action.disabled}
								onClick={() => props.action?.onClick()}
							>
								{props.action.label}
							</button>
						)}
					</form>
				</div>
			</div>
			<form method="dialog" class="modal-backdrop">
				<button type="submit">{m.grades_close_backdrop()}</button>
			</form>
		</dialog>
	);
}

/** Icon button that opens the students of a row. */
export function PeopleButton(props: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
}): JSX.Element {
	return (
		<button
			type="button"
			class="btn btn-ghost btn-sm btn-square"
			aria-label={props.label}
			title={props.label}
			disabled={props.disabled}
			onClick={props.onClick}
		>
			<Icon name="people" />
		</button>
	);
}
