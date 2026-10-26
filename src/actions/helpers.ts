import { ActionError } from "astro:actions";
import {
	FieldError,
	NotAllowed,
	NotFound,
	TooManyRequests,
} from "@/core/error";
import { m } from "@/i18n";

/// Maps the framework-agnostic service errors to the `ActionError` Astro
/// expects, and returns any other value unchanged.
function translateServiceError(error: unknown): unknown {
	if (error instanceof NotAllowed) {
		return new ActionError({ code: "FORBIDDEN", message: error.message });
	}
	if (error instanceof NotFound) {
		return new ActionError({ code: "NOT_FOUND", message: error.message });
	}
	if (error instanceof TooManyRequests) {
		return new ActionError({
			code: "TOO_MANY_REQUESTS",
			message: error.message,
		});
	}
	if (error instanceof FieldError) {
		return fieldActionError(error);
	}
	return error;
}

/// Builds an `ActionError` that serializes as Astro's input error. Astro does
/// not export `ActionInputError`, but `serializeActionResult` spreads the
/// error's own properties and `ActionError.fromJson` rebuilds an
/// `ActionInputError` from `type` and `issues`, so the client gets `fields`
/// as if the schema had failed.
function fieldActionError(error: FieldError): ActionError {
	const issues = [
		{ code: "custom", path: [error.field], message: error.message },
	];
	return Object.assign(
		new ActionError({ code: "BAD_REQUEST", message: error.message }),
		{
			type: "AstroActionInputError",
			issues,
			fields: { [error.field]: [error.message] },
		},
	);
}

/**
 * Wraps an Astro Action handler, translating a `NotAllowed` or a `NotFound`
 * thrown by a service (framework-agnostic, see `src/db/base-service.ts`) into
 * the `ActionError` Astro expects, `FORBIDDEN` or `NOT_FOUND`, and a
 * `FieldError` into an input error on its field. Any other thrown value
 * passes through unchanged.
 */
export function withActionErrors<Args extends unknown[], R>(
	handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
	return async (...args) => {
		try {
			return await handler(...args);
		} catch (error) {
			throw translateServiceError(error);
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
			const translated = translateServiceError(error);
			if (translated === error && error instanceof Error) {
				throw new ActionError({ code: "BAD_REQUEST", message: error.message });
			}
			throw translated;
		}
	};
}

/// What a unique-constraint violation on a user field says.
const UNIQUE_MESSAGES: Record<string, () => string> = {
	username: m.errors_unique_username_in_use,
	email: m.errors_unique_email_in_use,
	githubId: m.errors_unique_github_id_in_use,
	schoolId: m.errors_unique_school_id_in_use,
};

/// The columns a Prisma unique-constraint violation names, or `null` when `error` is not one.
function uniqueConstraintFields(error: unknown): string[] | null {
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
	return Array.isArray(target)
		? target
		: typeof target === "string"
			? [target]
			: [];
}

/**
 * Turns a Prisma unique-constraint violation into a message naming the conflicting field.
 */
export function uniqueConstraintMessage(error: unknown): string | null {
	const fields = uniqueConstraintFields(error);
	if (!fields) return null;
	const field = fields.find((f) => f in UNIQUE_MESSAGES);
	return (
		(field && UNIQUE_MESSAGES[field]?.()) || m.errors_unique_value_in_use()
	);
}

/**
 * Turns a Prisma unique-constraint violation into the error that shows on the conflicting form field.
 *
 * A violation on a column with no form field becomes a plain `ActionError`.
 * Throw the result from a handler wrapped by {@link withActionErrors} or {@link withServiceErrors}.
 */
export function uniqueConstraintError(
	error: unknown,
): FieldError | ActionError | null {
	const message = uniqueConstraintMessage(error);
	if (!message) return null;
	const field = uniqueConstraintFields(error)?.find(
		(f) => f in UNIQUE_MESSAGES,
	);
	return field
		? new FieldError(field, message)
		: new ActionError({ code: "CONFLICT", message });
}
