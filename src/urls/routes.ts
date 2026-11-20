import type { UrlPattern } from "@/generated/url-patterns";
import type { Marked } from "@/typing/branding";

export type { UrlPattern };

/** A URL of one of the server's own pages, built by a {@link Route}; a plain string is not one. */
export type Href = Marked<string, "Href">;

/** Values a route takes in its query string; `true` is written as `1`, `false` and `undefined` are left out. */
export type QueryParams = Record<string, string | number | boolean | undefined>;

/// The names of the `[parameter]` segments of `P`, a rest `[...name]` as `...name`.
type ParamNames<P extends string> =
	P extends `${string}[${infer Name}]${infer Rest}`
		? Name | ParamNames<Rest>
		: never;

/** The values that fill the `[parameter]` segments of `P`: a string each, the segments of a rest parameter as a list. */
export type RouteParams<P extends string> = {
	[N in ParamNames<P> as N extends `...${infer R}`
		? R
		: N]: N extends `...${string}` ? readonly string[] : string;
};

/// The arguments of a route: its parameters if it has any, then its query.
type RouteArgs<P extends string, Q extends QueryParams> = [
	ParamNames<P>,
] extends [never]
	? [query?: Q]
	: [params: RouteParams<P>, query?: Q];

/** A page or endpoint of the server: a function that builds its URL, tagged with the Astro pattern it is served by. */
export interface Route<
	P extends UrlPattern = UrlPattern,
	Q extends QueryParams = QueryParams,
> {
	(...args: RouteArgs<P, Q>): Href;
	/// The route as Astro writes it, e.g. `/admin/users` or `/invite/[token]`.
	readonly pattern: P;
}

/// The query a route accepts, declared by its type alone.
interface QuerySpec<Q extends QueryParams> {
	readonly query?: Q;
}

/**
 * Declares the query string a route accepts.
 *
 * @example
 * route("/login", query<{ next?: string }>());
 */
function query<Q extends QueryParams>(): QuerySpec<Q> {
	return {};
}

/// `?a=1&b=x` for the values of `query` that are set, or `""` when none is.
function queryString(query: QueryParams | undefined): string {
	const search = new URLSearchParams();
	for (const [name, value] of Object.entries(query ?? {})) {
		if (value === undefined || value === false) continue;
		search.set(name, value === true ? "1" : String(value));
	}
	const text = search.toString();
	return text === "" ? "" : `?${text}`;
}

/// `pattern` with each `[parameter]` replaced by its encoded value from `params`.
function fill(
	pattern: string,
	params: Record<string, string | readonly string[]>,
): string {
	return pattern.replace(/\[(\.\.\.)?(\w+)\]/g, (_, rest, name: string) => {
		const value = params[name] ?? "";
		return rest
			? (value as readonly string[]).map(encodeURIComponent).join("/")
			: encodeURIComponent(value as string);
	});
}

/// The route served at `pattern`: its parameters come from the pattern, its query from `_query`.
function route<
	P extends UrlPattern,
	Q extends QueryParams = Record<string, never>,
>(pattern: P, _query?: QuerySpec<Q>): Route<P, Q> {
	const hasParams = pattern.includes("[");
	const build = (...args: unknown[]) => {
		const [params, query] = hasParams ? args : [{}, args[0]];
		return `${fill(pattern, params as Record<string, string>)}${queryString(query as QueryParams | undefined)}` as Href;
	};
	return Object.assign(build as unknown as Route<P, Q>, { pattern });
}

/**
 * Every URL the server builds for its own pages, one function per route.
 *
 * Code links to a page through this registry instead of writing the path, so
 * renaming a page breaks the typecheck, not a link in production. Parameters
 * are taken from the pattern and encoded here.
 *
 * @example
 * urls.admin.users(); // "/admin/users"
 * urls.invite({ token: "a b" }); // "/invite/a%20b"
 * urls.login({ next: "/check-in" }); // "/login?next=%2Fcheck-in"
 */
export const urls = {
	/// The landing page; a signed-in visitor gets the home page instead.
	root: route("/"),
	home: route("/home"),
	login: route("/login", query<{ next?: string }>()),
	profile: route("/profile", query<{ tab?: "calendar" | "reports" }>()),
	gettingStarted: route("/getting-started"),
	calendar: route("/calendar", query<{ month?: string }>()),
	calendarFeed: route("/calendar/[token].ics"),
	courses: {
		index: route("/courses", query<{ left?: boolean }>()),
		join: route("/courses/join", query<{ code?: string }>()),
	},
	invite: route("/invite/[token]"),
	checkIn: route("/check-in"),
	/// The link a roll call's QR code points to.
	rollCallCheckIn: route("/c/[rollCallId]/[code]"),
	forbidden: route("/403"),
	notFound: route("/404"),
	serverError: route("/500"),
	admin: {
		index: route("/admin"),
		users: route("/admin/users"),
		courses: route("/admin/courses"),
		disciplines: route("/admin/disciplines"),
		editions: route("/admin/editions"),
		reports: route("/admin/reports"),
	},
} as const;
