import { actions } from "astro:actions";
import { createSignal, type JSX, Show } from "solid-js";

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
	const [asInvite, setAsInvite] = createSignal(false);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	let dialog: HTMLDialogElement | undefined;

	async function open(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.rollCall.open({
			discipline: props.discipline,
			course: props.course,
			week: props.week,
			timeSlot: props.timeSlot,
			actsAsInvite: asInvite(),
		});
		if (error) {
			setBusy(false);
			setFailure(error.message);
			return;
		}
		window.location.href = `${props.href}/roll-call/${props.week}/${props.timeSlot}`;
	}

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
					<Show when={failure()}>
						{(message) => (
							<div role="alert" class="alert alert-error mt-4">
								{message()}
							</div>
						)}
					</Show>
					<label class="label mt-4 cursor-pointer justify-start gap-3">
						<input
							type="checkbox"
							class="checkbox"
							checked={asInvite()}
							onChange={(e) => setAsInvite(e.currentTarget.checked)}
						/>
						<span>Counts as an invite</span>
					</label>
					<p class="text-xs text-base-content/60">
						Anyone who checks in is enrolled, and gets an account if they have
						none.
					</p>
					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost"
							disabled={busy()}
							onClick={() => dialog?.close()}
						>
							Cancel
						</button>
						<button
							type="button"
							class="btn btn-primary"
							disabled={busy()}
							onClick={open}
						>
							Open roll call
						</button>
					</div>
				</div>
				<form method="dialog" class="modal-backdrop">
					<button type="submit">close</button>
				</form>
			</dialog>
		</>
	);
}
