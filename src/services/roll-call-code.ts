import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/// Characters a code may use: no 0/O, 1/I/L.
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// Length of a code.
const CODE_LENGTH = 6;

/// Duration of the window in which a code is shown.
const WINDOW_MS = 15_000;

/// How long a code stays valid after its window ends.
const GRACE_MS = 30_000;

/// Number of past windows (besides the current one) whose code is still valid.
const PAST_WINDOWS = GRACE_MS / WINDOW_MS;

/// Returns the code of window `counter`.
function codeForWindow(secret: string, counter: number): string {
	const message = Buffer.alloc(8);
	message.writeBigUInt64BE(BigInt(counter));
	const digest = createHmac("sha256", secret).update(message).digest();
	let code = "";
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += CODE_ALPHABET.charAt((digest[i] ?? 0) % CODE_ALPHABET.length);
	}
	return code;
}

/**
 * Returns a new random secret for a roll call.
 */
export function generateSecret(): string {
	return randomBytes(32).toString("base64url");
}

/**
 * Returns the code shown at `at`, the instant it came up and the instant it is replaced.
 */
export function codeAt(
	secret: string,
	at: Date,
): { code: string; changedAt: Date; nextChangeAt: Date } {
	const counter = Math.floor(at.getTime() / WINDOW_MS);
	return {
		code: codeForWindow(secret, counter),
		changedAt: new Date(counter * WINDOW_MS),
		nextChangeAt: new Date((counter + 1) * WINDOW_MS),
	};
}

/**
 * Whether `code` (any case, surrounding spaces ignored) is accepted at `at`.
 */
export function isCodeValid(secret: string, code: string, at: Date): boolean {
	const given = Buffer.from(code.trim().toUpperCase());
	const current = Math.floor(at.getTime() / WINDOW_MS);
	let valid = false;
	for (let back = 0; back <= PAST_WINDOWS; back++) {
		const expected = Buffer.from(codeForWindow(secret, current - back));
		// Compare every candidate so timing does not reveal which one matched.
		if (given.length === expected.length && timingSafeEqual(given, expected)) {
			valid = true;
		}
	}
	return valid;
}
