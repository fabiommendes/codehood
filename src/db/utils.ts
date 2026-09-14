import { NotFound } from "@/core/error";

/**
 * Ensure object exists or raise a NotFound error.
 *
 * The optional arguments are passed to the {@link NotFound} constructor.
 */
export function ensureExist<T>(
	value: T | null | undefined,
	resource: string,
	args?: { id?: number | string; context?: string; message?: string },
): T {
	if (value === null || value === undefined) throw new NotFound(resource, args);
	return value;
}
