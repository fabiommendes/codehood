import { createSignal, onCleanup } from "solid-js";

/**
 * Formats a duration in milliseconds as `m:ss`, rounding up and never negative.
 *
 * @example
 * formatCountdown(61_000); // "1:01"
 */
export function formatCountdown(ms: number): string {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return `${minutes}:${seconds}`;
}

/// A signal with the current time in milliseconds, refreshed every second.
export function createNow(initial: number): () => number {
	const [now, setNow] = createSignal(initial);
	const timer = setInterval(() => setNow(Date.now()), 1000);
	onCleanup(() => clearInterval(timer));
	return now;
}
