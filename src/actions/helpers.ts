import { ActionError } from "astro:actions";
import { NotAllowed } from "@/core/error";

/**
 * Wraps an Astro Action handler, translating a `NotAllowed` thrown by a
 * service (framework-agnostic, see `src/db/base-service.ts`) into the
 * `ActionError({ code: "FORBIDDEN" })` Astro expects. Any other thrown value
 * passes through unchanged.
 */
export function withActionErrors<Args extends unknown[], R>(
	handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
	return async (...args) => {
		try {
			return await handler(...args);
		} catch (error) {
			if (error instanceof NotAllowed) {
				throw new ActionError({ code: "FORBIDDEN", message: error.message });
			}
			throw error;
		}
	};
}

/**
 * Like {@link withActionErrors}, but also surfaces a plain `Error`'s message
 * as `BAD_REQUEST` instead of letting Astro mask it. Use this where the
 * service's thrown messages ("2026-01" is not a valid slug", "Passphrase
 * "AB12CD" is already in use") are written for the form they surface in, not
 * for a log.
 */
export function withServiceErrors<Args extends unknown[], R>(
	handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
	return async (...args) => {
		try {
			return await handler(...args);
		} catch (error) {
			if (error instanceof NotAllowed) {
				throw new ActionError({ code: "FORBIDDEN", message: error.message });
			}
			if (error instanceof Error) {
				throw new ActionError({ code: "BAD_REQUEST", message: error.message });
			}
			throw error;
		}
	};
}
