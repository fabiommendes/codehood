/**
 * Pure functions for parsing course URLs, per `src/urls/README.md`.
 */

import { InvalidData } from "@/core/error";
import { EDITION_RE, RESERVED_USERNAMES, USERNAME_RE } from "./constants";

export interface CourseNaturalKey {
	discipline: string;
	instructor: string;
	edition: string;
}

/**
 * Splits a course URL segment (`<username>_<edition>`) at its last
 * underscore.
 *
 * Returns `null` for a malformed segment.
 */
export function parseCourseSegment(
	segment: string,
): { instructor: string; edition: string } | null {
	const i = segment.lastIndexOf("_");
	if (i < 0) return null;

	const instructor = parseUsername(segment.slice(0, i));
	const edition = parseEdition(segment.slice(i + 1));

	return instructor && edition ? { instructor, edition } : null;
}

/**
 * Validate an username string.
 */
export function parseUsername(username: string): string | null {
	if (USERNAME_RE.test(username) && !RESERVED_USERNAMES.has(username))
		return username;
	return null;
}

/**
 * Validate an username string.
 */
export function parseEdition(edition: string): string | null {
	if (EDITION_RE.test(edition)) return edition;
	return null;
}

/**
 * Turns a course's two path segments into a course natural key.
 *
 * Throws `InvalidData` (400) for a segment that does not match the grammar.
 * That is a deliberate divergence from the web app, which rounds a malformed
 * course URL down to a 404: a person typing a URL cannot act on a 400, but a
 * tool (the CLI, or an Astro Action's client call) can, and reporting bad
 * local configuration as "no such course" sends them hunting for the wrong
 * problem.
 */
export function parseCourseParams(
	params: Record<string, string>,
): CourseNaturalKey {
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

	if (!params.discipline) {
		throw new InvalidData(
			{ discipline: [{ code: "missing", message: "Discipline is required." }] },
			{ message: "Missing discipline segment." },
		);
	}

	return {
		discipline: params.discipline,
		instructor: segment.instructor,
		edition: segment.edition,
	};
}
