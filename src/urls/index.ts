import type { CourseRef } from "./parsing";

export {
	DISCIPLINE_SLUG_RE,
	EDITION_RE,
	RESERVED_SLUGS,
	USERNAME_RE,
} from "./constants";
export type { CourseRef } from "./parsing";
export * from "./parsing";

/** Builds `/<discipline-slug>/<username>_<edition>` for a course. */
export function courseHref(ref: CourseRef): string {
	return `/${ref.discipline}/${ref.instructor}_${ref.edition}`;
}
