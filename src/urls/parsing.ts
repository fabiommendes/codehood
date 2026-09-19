/**
 * Pure functions for parsing course URLs, per `docs/design/url-structure.md`.
 */

import { EDITION_RE, RESERVED_USERNAMES, USERNAME_RE } from "./constants";

export interface CourseRef {
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
