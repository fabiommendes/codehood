import type { UrlPattern } from "@/generated/url-patterns";
import type { Marked } from "@/typing/branding";

export type { UrlPattern };

/** A URL of one of the server's own pages, built by a {@link Route}; a plain string is not one. */
export type Href = Marked<string, "Href">;

/** A page or endpoint of the server: a function that builds its URL, tagged with the Astro pattern it is served by. */
export interface Route<
	Args extends unknown[] = [],
	P extends UrlPattern = UrlPattern,
> {
	(...args: Args): Href;
	/// The route as Astro writes it, e.g. `/admin/users` or `/[discipline]/[course]`.
	readonly pattern: P;
}

/// `P` if it has no `[parameter]` segment, `never` otherwise.
type Static<P extends string> = P extends `${string}[${string}` ? never : P;

/// A route whose URL is its pattern: one with no parameters.
function staticRoute<P extends UrlPattern>(pattern: Static<P>): Route<[], P> {
	return Object.assign(() => pattern as string as Href, { pattern });
}

/**
 * Every URL the server builds for its own pages, one function per route.
 *
 * Code links to a page through this registry instead of writing the path, so
 * renaming a page breaks the typecheck, not a link in production.
 *
 * @example
 * urls.admin.users(); // "/admin/users"
 */
export const urls = {
	admin: {
		index: staticRoute("/admin"),
		users: staticRoute("/admin/users"),
		courses: staticRoute("/admin/courses"),
		disciplines: staticRoute("/admin/disciplines"),
		editions: staticRoute("/admin/editions"),
		reports: staticRoute("/admin/reports"),
	},
} as const;
