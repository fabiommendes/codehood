/// The wait before the first retry of a failed save, in milliseconds.
export const RETRY_BASE_MS = 2_000;

/// The longest wait between two retries, in milliseconds.
export const RETRY_CAP_MS = 30_000;

/**
 * The wait before retrying after `failures` consecutive failed saves.
 *
 * It doubles with each failure up to `RETRY_CAP_MS`, and jitter takes off up to
 * half of it so students who lost the connection together do not come back
 * together.
 *
 * @example
 * retryDelay(1, () => 1); // 2000
 * retryDelay(2, () => 0); // 2000
 */
export function retryDelay(
	failures: number,
	random: () => number = Math.random,
): number {
	const exponent = Math.max(0, failures - 1);
	const delay = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** exponent);
	return delay * (0.5 + random() * 0.5);
}
