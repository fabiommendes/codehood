/**
 * A link within the grading pages, carrying the names switch along.
 *
 * @example
 * gradingHref("/d/c/exams/e/grading", { names: true }); // "/d/c/exams/e/grading?names=1"
 */
export function gradingHref(
	path: string,
	opts: { names?: boolean; anchor?: string } = {},
): string {
	return `${path}${opts.names ? "?names=1" : ""}${opts.anchor ? `#${opts.anchor}` : ""}`;
}

/// Whether the request asks the grading pages to show the students' names.
export function wantsNames(url: URL): boolean {
	return url.searchParams.get("names") === "1";
}
