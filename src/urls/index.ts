import type { CourseNaturalKey } from "./parsing";
import { type Href, urls } from "./routes";

export {
	DISCIPLINE_SLUG_RE,
	EDITION_RE,
	RESERVED_SLUGS,
	RESERVED_USERNAMES,
	USERNAME_INPUT_RE,
	USERNAME_RE,
} from "./constants";
export type { CourseNaturalKey as CourseRef } from "./parsing";
export * from "./parsing";

/** Builds `/<discipline-slug>/<username>_<edition>` for a course. */
export function courseHref(ref: CourseNaturalKey): Href {
	return urls.course(ref).index();
}

export * from "./attachments";
export {
	type Anchor,
	anchor,
	type CourseUrls,
	courseRoutes,
	currentPage,
	type ExamUrls,
	type ExternalUrl,
	external,
	type Href,
	type LinkTarget,
	playgroundPage,
	type Route,
	type UrlPattern,
	urls,
	withAnchor,
	withSearch,
} from "./routes";
