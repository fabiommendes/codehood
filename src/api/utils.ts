import { InvalidData } from "@/core/error";
import { m } from "@/i18n";

/**
 * Throw a 404 error if the entity is null, otherwise return the entity.
 *
 * Useful to put in the return statement of a service method that returns the entity:
 *
 * ```ts
 * const user = await userService.findOne(filter, opts);
 * return entityOr404(user);
 * ```
 */
export function entityOr404<T>(entity: T | null): T {
	if (!entity) {
		// TODO: define a NotFoundError class and throw that instead of a generic Error
		throw new Error("Entity not found");
	}
	return entity;
}

/**
 * Turns a calendar event's `week` path segment into a non-negative integer.
 *
 * Throws `InvalidData` (400) for anything else, on the same reasoning as
 * `parseCourseParams`: the caller is a tool, and it can act on a 400.
 */
export function parseWeekParam(raw: string): number {
	const week = Number(raw);
	if (!Number.isInteger(week) || week < 0) {
		throw new InvalidData(
			{
				week: [
					{
						code: "type-mismatch",
						message: m.errors_expected_non_negative_integer(),
					},
				],
			},
			{ message: m.errors_not_a_week_number({ value: raw }) },
		);
	}
	return week;
}
