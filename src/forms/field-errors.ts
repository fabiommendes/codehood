import { type ActionError, isInputError } from "astro:actions";

/** Errors of a failed action, split into per-field and general messages. */
export type FieldErrors = {
	fields: Record<string, string[]>;
	/// Set when the error does not belong to a field (forbidden, not found...).
	message?: string;
};

/**
 * Splits an Astro action error into per-field messages and a general one.
 *
 * Input errors map to `fields`; any other error becomes `message`.
 */
export function fieldErrors(error: ActionError): FieldErrors {
	if (isInputError(error)) {
		return { fields: error.fields as Record<string, string[]> };
	}
	return { fields: {}, message: errorMessage(error) };
}

/**
 * The text to show for an action error with no field to hold it.
 *
 * An input error carries Astro's "Failed to validate" JSON dump as its message, so its field messages are shown instead.
 */
export function errorMessage(error: ActionError): string {
	if (isInputError(error)) {
		const messages = Object.values(error.fields).flat();
		return messages.length > 0 ? messages.join(" ") : "Invalid input.";
	}
	return error.message;
}
