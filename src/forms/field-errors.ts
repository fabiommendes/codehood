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
	return { fields: {}, message: error.message };
}
