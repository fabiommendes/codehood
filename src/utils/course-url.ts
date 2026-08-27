/**
 * Pure functions for building and parsing course URLs, per
 * `docs/design/url-structure.md`. No Prisma import, so the parsing and
 * reserved-word rules get unit tests that run without a database.
 */

export interface CourseRef {
	disciplineSlug: string;
	username: string;
	edition: string;
}

/** `^[a-z][a-z0-9-]{1,30}[a-z0-9]$` — lowercase, starts with a letter, no trailing hyphen. */
export const DISCIPLINE_SLUG_RE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** `^[a-z0-9][a-z0-9-]{1,30}$` — excludes underscore, the course-segment separator. */
export const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

/** A four-digit year, optionally followed by `-` and a term number with no leading zero. */
export const EDITION_RE = /^[0-9]{4}(-([1-9][0-9]*|0))?$/;

/**
 * Top-level names a discipline slug must not equal, because the root
 * namespace is shared with every system route. Includes both routes that
 * exist today and a buffer of names reserved for future use.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	"403",
	"404",
	"500",
	"_actions",
	"_astro",
	"_image",
	"admin",
	"api",
	"calendar",
	"courses",
	"design",
	"favicon",
	"getting-started",
	"img",
	"invite",
	"login",
	"logo",
	"manifest",
	"profile",
	"sw",
	"about",
	"docs",
	"help",
	"logout",
	"me",
	"new",
	"search",
	"settings",
	"signup",
	"static",
	"users",
]);

/** Builds `/<discipline-slug>/<username>_<edition>` for a course. */
export function courseHref(ref: CourseRef): string {
	return `/${ref.disciplineSlug}/${ref.username}_${ref.edition}`;
}

/**
 * Splits a course URL segment (`<username>_<edition>`) at its last
 * underscore — editions never contain one, so this stays correct even if
 * usernames ever do. Returns `null` for a malformed segment, which callers
 * should treat as a 404, not a 400.
 */
export function parseCourseSegment(
	segment: string,
): { username: string; edition: string } | null {
	const i = segment.lastIndexOf("_");
	if (i < 0) return null;
	const username = segment.slice(0, i);
	const edition = segment.slice(i + 1);
	if (!username || !EDITION_RE.test(edition)) return null;
	return { username, edition };
}
