/// Whether the request asks the grading pages to show the students' names.
export function wantsNames(url: URL): boolean {
	return url.searchParams.get("names") === "1";
}

/// Whether the request asks for the grading page of a question as a list of every answer.
export function wantsList(url: URL): boolean {
	return url.searchParams.get("view") === "list";
}
