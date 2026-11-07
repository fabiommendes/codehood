/**
 * A link within the grading pages, carrying the names switch and the list view along.
 *
 * @example
 * gradingHref("/d/c/exams/e/grading", { names: true }); // "/d/c/exams/e/grading?names=1"
 * gradingHref("/d/c/exams/e/grading/q", { list: true, names: true }); // "/d/c/exams/e/grading/q?view=list&names=1"
 */
export function gradingHref(
	path: string,
	opts: { names?: boolean; list?: boolean; anchor?: string } = {},
): string {
	const query = [opts.list && "view=list", opts.names && "names=1"].filter(
		Boolean,
	);
	return `${path}${query.length > 0 ? `?${query.join("&")}` : ""}${opts.anchor ? `#${opts.anchor}` : ""}`;
}

/// Whether the request asks the grading pages to show the students' names.
export function wantsNames(url: URL): boolean {
	return url.searchParams.get("names") === "1";
}

/// Whether the request asks for the grading page of a question as a list of every answer.
export function wantsList(url: URL): boolean {
	return url.searchParams.get("view") === "list";
}
