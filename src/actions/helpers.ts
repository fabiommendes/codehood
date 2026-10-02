import { ActionError } from "astro:actions";
import { NotAllowed, NotFound } from "@/core/error";

/**
 * Wraps an Astro Action handler, translating a `NotAllowed` or a `NotFound`
 * thrown by a service (framework-agnostic, see `src/db/base-service.ts`) into
 * the `ActionError` Astro expects, `FORBIDDEN` or `NOT_FOUND`. Any other
 * thrown value passes through unchanged.
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
			if (error instanceof NotFound) {
				throw new ActionError({ code: "NOT_FOUND", message: error.message });
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
			if (error instanceof NotFound) {
				throw new ActionError({ code: "NOT_FOUND", message: error.message });
			}
			if (error instanceof Error) {
				throw new ActionError({ code: "BAD_REQUEST", message: error.message });
			}
			throw error;
		}
	};
}

/// How a unique user field reads in a form error.
const FIELD_LABELS: Record<string, string> = {
	username: "username",
	email: "email",
	githubId: "GitHub username",
	schoolId: "school id",
};

/**
 * Turns a Prisma unique-constraint violation into a message naming the conflicting field.
 */
export function uniqueConstraintMessage(error: unknown): string | null {
	if (
		typeof error !== "object" ||
		error === null ||
		(error as { code?: string }).code !== "P2002"
	) {
		return null;
	}
	// The classic engine reports meta.target; the better-sqlite3 driver adapter instead
	// nests it under meta.driverAdapterError.cause.constraint.fields. Check both shapes.
	const meta = (error as { meta?: Record<string, unknown> }).meta ?? {};
	const adapterFields = (
		meta.driverAdapterError as
			| { cause?: { constraint?: { fields?: unknown } } }
			| undefined
	)?.cause?.constraint?.fields;
	const target = meta.target ?? adapterFields;
	const fields = Array.isArray(target)
		? target
		: typeof target === "string"
			? [target]
			: [];
	const field = fields.map((f) => FIELD_LABELS[f]).find(Boolean);
	return field
		? `That ${field} is already in use.`
		: "One of those values is already in use.";
}
