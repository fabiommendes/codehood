import type { CourseNaturalKey } from "./parsing";

export {
	DISCIPLINE_SLUG_RE,
	EDITION_RE,
	RESERVED_SLUGS,
	USERNAME_RE,
} from "./constants";
export type { CourseNaturalKey as CourseRef } from "./parsing";
export * from "./parsing";

/** Builds `/<discipline-slug>/<username>_<edition>` for a course. */
export function courseHref(ref: CourseNaturalKey): string {
	return `/${ref.discipline}/${ref.instructor}_${ref.edition}`;
}
