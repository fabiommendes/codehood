import { ActionError } from "astro:actions";
import { ForbiddenError } from "@/db/base-service";

/**
 * Wraps an Astro Action handler, translating a `ForbiddenError` thrown by a
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
			if (error instanceof ForbiddenError) {
				throw new ActionError({ code: "FORBIDDEN", message: error.message });
			}
			throw error;
		}
	};
}
