import { InvalidData } from "@/core/error";
import { schema } from "@/db";

import { parseCourseSegment } from "@/urls";

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
 * Turns a course's two path segments into a course natural Key
 *
 * Throws `InvalidData` (400) for a segment that does not match the grammar.
 * That is a deliberate divergence from the web app, which rounds a malformed
 * course URL down to a 404: a person typing a URL cannot act on a 400, but the
 * CLI can, and reporting bad local configuration as "no such course" sends
 * them hunting for the wrong problem.
 */
export function parseCourseParams(params: Record<string, string>) {
	const segment = parseCourseSegment(params.course ?? "");

	if (!segment) {
		const error = {
			code: "pattern-mismatch",
			message: "Expected course as <instructor>_<edition>.",
		} as const;
		throw new InvalidData(
			{ course: [error] },
			{ message: `"${params.course}" is not a course segment.` },
		);
	}

	return InvalidData.zodValidate(
		schema.courseNaturalKey.safeParse({
			discipline: params.discipline,
			instructor: segment.instructor,
			edition: segment.edition,
		}),
	);
}

/**
 * Turns a course's two path segments plus `[slug]` into a `resourcePkRef`.
 */
export function parseResourceParams(params: Record<string, string>) {
	const courseRef = parseCourseParams(params);
	const validated = schema.resourcePkRef.safeParse({
		ref: { courseRef, slug: params.slug },
	});
	if (validated.error)
		throw InvalidData.fromZodError(validated.error, validated.data);
	return validated.data;
}
