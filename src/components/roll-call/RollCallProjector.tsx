import { actions } from "astro:actions";
import { createSignal, type JSX, onCleanup, onMount, Show } from "solid-js";
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
		qr: string;
		present: number;
		closesAt: Date;
	};
	/// Server time when the page rendered, in milliseconds.
	now: number;
}

/// How often the projection asks the server for the current code.
const POLL_MS = 3000;

/**
 * The full screen projection of a roll call: a large QR code, the code as
 * text, the time left and how many students are present.
 */
export default function RollCallProjector(
	props: RollCallProjectorProps,
): JSX.Element {
	const [shown, setShown] = createSignal(props.initial);
	const now = createNow(props.now);
	const isOpen = () => shown().closesAt.getTime() > now();

	async function poll(): Promise<void> {
		const { data } = await actions.rollCall.currentCode({
			discipline: props.discipline,
			course: props.course,
			week: props.week,
			timeSlot: props.timeSlot,
		});
		if (data) setShown(data);
	}

	onMount(() => {
		const timer = setInterval(poll, POLL_MS);
		onCleanup(() => clearInterval(timer));
	});

	return (
		<main class="flex min-h-screen flex-col items-center justify-center gap-6 bg-base-100 p-6 text-center">
			<h1 class="text-3xl font-bold">{props.title}</h1>
			<Show when={isOpen()} fallback={<p class="text-2xl">Roll call closed</p>}>
				<div
					role="img"
					aria-label="QR code to check in"
					class="aspect-square w-[min(70vh,90vw)] rounded-box bg-white p-4 [&>svg]:h-full [&>svg]:w-full"
					innerHTML={shown().qr}
				/>
				<p
					role="status"
					aria-live="off"
					aria-label="Check-in code"
					class="font-mono text-6xl font-bold tracking-[0.3em]"
				>
					{shown().code}
				</p>
				<p class="font-mono text-xl">
					Closes in {formatCountdown(shown().closesAt.getTime() - now())}
				</p>
			</Show>
			<p class="text-2xl">{shown().present} present</p>
			<a class="btn btn-ghost btn-sm" href={props.manageHref}>
				Back to the roll call
			</a>
		</main>
	);
}
