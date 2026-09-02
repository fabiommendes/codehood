/**
 * Turns free text into a lowercase, hyphenated, filesystem/URL-safe token.
 * Used to build a download filename from a resource's title (see
 * `dev/specs/to-do/resources.md`, "The download name").
 */
export function slugify(text: string): string {
	const slug = text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "") // strip diacritics after NFKD decomposition
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "file";
}
