/// Settings of a limiter: how many failures a key may take, and the window they count in.
export interface LimiterOptions {
	max: number;
	windowMs: number;
}

/// A fixed-window failure counter keyed by string.
export interface Limiter {
	/// Whether `key` has more than `max` failures in the window open at `now`.
	blocked(key: string, now: Date): boolean;
	/// Records one failure for `key` at `now`.
	fail(key: string, now: Date): void;
}

/// The failures of one key in its open window.
interface Window {
	count: number;
	/// Epoch milliseconds when the window ends, exclusive.
	endsAt: number;
}

/**
 * Creates a limiter that blocks a key after `max` failures within `windowMs`.
 *
 * Each key has its own counter. The window starts at the key's first recorded
 * failure in it and ends `windowMs` later, when the counter starts over.
 */
export function createLimiter(options: LimiterOptions): Limiter {
	const { max, windowMs } = options;
	const windows = new Map<string, Window>();
	/// When expired windows were last dropped from `windows`.
	let sweptAt = Number.NEGATIVE_INFINITY;

	/// Drops every window that has ended, at most once per `windowMs`.
	function sweep(time: number): void {
		if (time < sweptAt + windowMs) return;
		sweptAt = time;
		for (const [key, window] of windows) {
			if (time >= window.endsAt) windows.delete(key);
		}
	}

	return {
		blocked(key, now) {
			const window = windows.get(key);
			return (
				window !== undefined &&
				now.getTime() < window.endsAt &&
				window.count > max
			);
		},
		fail(key, now) {
			const time = now.getTime();
			sweep(time);
			const window = windows.get(key);
			if (window !== undefined && time < window.endsAt) {
				window.count++;
			} else {
				windows.set(key, { count: 1, endsAt: time + windowMs });
			}
		},
	};
}
