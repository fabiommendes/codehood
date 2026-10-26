import { actions } from "astro:actions";
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
import FormAlert from "@/components/form/FormAlert";
import { errorMessage } from "@/forms/field-errors";
import { m } from "@/i18n";
import { createNow, formatCountdown } from "./countdown";

export interface RollCallProjectorProps {
	/// The roll call's address, as the roll call actions take it.
	discipline: string;
	course: string;
	week: number;
	timeSlot: string;
	title: string;
	/// The management page, linked back from the projection.
	manageHref: string;
	initial: {
		code: string;
		/// When `code` came up on screen.
		changedAt: Date;
		/// When `code` is replaced by the next one.
		nextChangeAt: Date;
		qr: string;
		present: number;
		closesAt: Date;
	};
	/// Server time when the page rendered, in milliseconds.
	now: number;
}

/// How often the projection asks the server for the current code.
const POLL_MS = 3000;

/// How long after a code's window ends the projection asks for the next one.
const ROTATION_DELAY_MS = 250;

/**
 * The full screen projection of a roll call: a large QR code, the code as
 * text with a bar draining until it rotates, the time left and how many
 * students are present.
 *
 * Besides polling, it asks for the next code as soon as the current one's
 * window ends. A closed roll call offers a large button to reopen it.
 */
export default function RollCallProjector(
	props: RollCallProjectorProps,
): JSX.Element {
	const [shown, setShown] = createSignal(props.initial);
	const now = createNow(props.now);
	const [busy, setBusy] = createSignal(false);
	const [failure, setFailure] = createSignal<string | null>(null);
	const isOpen = () => shown().closesAt.getTime() > now();
	const target = {
		discipline: props.discipline,
		course: props.course,
		week: props.week,
		timeSlot: props.timeSlot,
	};

	/// Fraction of the current code's window still ahead, from 1 down to 0.
	const codeLeft = () => {
		const { changedAt, nextChangeAt } = shown();
		const length = nextChangeAt.getTime() - changedAt.getTime();
		const left = (nextChangeAt.getTime() - now()) / length;
		return Math.min(1, Math.max(0, left));
	};

	let rotation: ReturnType<typeof setTimeout> | undefined;

	async function poll(): Promise<void> {
		const { data } = await actions.rollCall.currentCode(target);
		if (!data) return;
		setShown(data);
		clearTimeout(rotation);
		rotation = setTimeout(
			poll,
			data.nextChangeAt.getTime() - Date.now() + ROTATION_DELAY_MS,
		);
	}

	async function reopen(): Promise<void> {
		setBusy(true);
		setFailure(null);
		const { error } = await actions.rollCall.open(target);
		if (error) setFailure(errorMessage(error));
		else await poll();
		setBusy(false);
	}

	onMount(() => {
		const timer = setInterval(poll, POLL_MS);
		void poll();
		onCleanup(() => {
			clearInterval(timer);
			clearTimeout(rotation);
		});
	});

	return (
		<main class="flex h-screen max-h-screen flex-col gap-4 overflow-hidden bg-base-100 p-6 text-center">
			<header class="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
				<a
					class="btn btn-ghost btn-sm justify-self-start"
					href={props.manageHref}
				>
					{m.attendance_projector_back()}
				</a>
				<h1 class="text-3xl font-bold">{props.title}</h1>
				<p class="justify-self-end text-2xl">
					{m.attendance_projector_present({ count: shown().present })}
				</p>
			</header>
			<FormAlert error={failure() ?? undefined} />
			<Show
				when={isOpen()}
				fallback={
					<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6">
						<p class="text-2xl">{m.attendance_manager_closed()}</p>
						<button
							type="button"
							class="btn btn-primary h-auto flex-col gap-4 rounded-box px-16 py-10 text-2xl"
							disabled={busy()}
							onClick={reopen}
						>
							<RefreshIcon />
							{m.attendance_manager_reopen()}
						</button>
					</div>
				}
			>
				{/* Sized by the free space's shorter side, so the page never scrolls. */}
				<div class="flex min-h-0 flex-1 items-center justify-center [container-type:size]">
					<div
						role="img"
						aria-label={m.attendance_projector_qr()}
						class="size-[min(100cqw,100cqh)] rounded-box bg-white p-4 [&>svg]:h-full [&>svg]:w-full"
						innerHTML={shown().qr}
					/>
				</div>
				<div class="flex flex-col items-center gap-3">
					<p
						role="status"
						aria-live="off"
						aria-label={m.attendance_projector_code()}
						class="font-mono text-6xl font-bold tracking-[0.3em]"
					>
						{shown().code}
					</p>
					<progress
						class="progress progress-primary h-3 w-full max-w-2xl [&::-moz-progress-bar]:transition-all [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-1000 [&::-webkit-progress-value]:ease-linear"
						aria-label={m.attendance_projector_code_left()}
						max={1000}
						value={Math.round(codeLeft() * 1000)}
					/>
					<p class="font-mono text-xl">
						{m.attendance_closes_in({
							time: formatCountdown(shown().closesAt.getTime() - now()),
						})}
					</p>
				</div>
			</Show>
		</main>
	);
}

/// A circular arrow, for the button that reopens the roll call.
function RefreshIcon(): JSX.Element {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-24 w-24"
			aria-hidden="true"
		>
			<path d="M21 12a9 9 0 1 1-2.64-6.36" />
			<path d="M21 3v6h-6" />
		</svg>
	);
}
