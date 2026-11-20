import type { UrlPattern } from "@/generated/url-patterns";
import type { Marked } from "@/typing/branding";
import type { CourseNaturalKey as CourseRef } from "./parsing";

export type { UrlPattern };

/** A URL of one of the server's own pages, built by a {@link Route}; a plain string is not one. */
export type Href = Marked<string, "Href">;

/** A URL outside the server's own pages (another site, `mailto:`), marked by {@link external}. */
export type ExternalUrl = Marked<string, "ExternalUrl">;

/** A fragment of the current page, `#id`, marked by {@link anchor}. */
export type Anchor = Marked<`#${string}`, "Anchor">;

/** What a `<Link>` may point to: a page of ours, another site, or a fragment of the current page. */
export type LinkTarget = Href | ExternalUrl | Anchor;

/**
 * Marks `url` as a link out of the server: another site or a `mailto:`.
 *
 * @example
 * external("https://github.com/fabiommendes/codehood");
 */
export function external(url: string | URL): ExternalUrl {
	return String(url) as ExternalUrl;
}

/**
 * The fragment `#id` of the current page; `""` gives the bare `#`.
 *
 * @example
 * anchor("how-it-works"); // "#how-it-works"
 */
export function anchor(id: string): Anchor {
	return `#${id}` as Anchor;
}

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
	const filled = pattern.replace(
		/\[(\.\.\.)?(\w+)\]/g,
		(_, rest, name: string) => {
			const value = params[name] ?? "";
			return rest
				? (value as readonly string[]).map(encodeURIComponent).join("/")
				: encodeURIComponent(value as string);
		},
	);
	// An empty rest parameter leaves a trailing slash the page is not served at.
	return filled.length > 1 ? filled.replace(/\/$/, "") : filled;
}

/**
 * `href` with `id` as its fragment, still an {@link Href}.
 *
 * @example
 * withAnchor(urls.home(), "today"); // "/home#today"
 */
export function withAnchor(href: Href, id: string): Href {
	return `${href}#${encodeURIComponent(id)}` as Href;
}

/**
 * `href` with a query string built elsewhere, for the pages whose filters
 * have a codec of their own (`?status=draft,hidden&sort=title`); `""` and
 * `"?"` leave `href` as it is.
 */
export function withSearch(href: Href, search: string | URLSearchParams): Href {
	const text = String(search).replace(/^\?/, "");
	return (text === "" ? href : `${href}?${text}`) as Href;
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
	files: {
		/// A stored file by its hash.
		blob: route("/files/[hash]"),
		/// A stored file by its hash, with the name the browser saves it as.
		named: route("/files/[hash]/[name]"),
	},
	design: {
		index: route("/design"),
		brand: route("/design/brand"),
		colors: route("/design/colors"),
		components: {
			index: route("/design/components"),
			course: route("/design/components/course"),
			exams: route("/design/components/exams"),
			grading: route("/design/components/grading"),
			reports: route("/design/components/reports"),
			schedule: route("/design/components/schedule"),
			ui: route("/design/components/ui"),
		},
		crash: route("/design/crash"),
		elements: route("/design/elements"),
		forms: route("/design/forms"),
		layouts: {
			index: route("/design/layouts"),
			appLayout: route("/design/layouts/app-layout"),
			centeredLayout: route("/design/layouts/centered-layout"),
			designLayout: route("/design/layouts/design-layout"),
			layout: route("/design/layouts/layout"),
		},
		motifs: route("/design/motifs"),
		playground: route("/design/playground"),
		questions: route("/design/questions"),
		runner: route("/design/runner"),
		themes: route("/design/themes"),
		typography: route("/design/typography"),
	},
	course: courseUrls,
} as const;

/**
 * A page of the design playground, by its path below `/design/playground/`.
 *
 * Playground pages come and go with the design work, so they are found by
 * listing the folder rather than registered one by one.
 */
export function playgroundPage(path: string): Href {
	return `/design/playground/${path.split("/").map(encodeURIComponent).join("/")}` as Href;
}

/// The query of the grading pages: the list view of a question and the students' names.
type GradingQuery = { view?: "list"; names?: boolean };

/** Every route under a course, keyed as `urls.course(ref)` exposes them. */
export const courseRoutes = {
	index: route("/[discipline]/[course]", query<{ joined?: boolean }>()),
	assignments: route("/[discipline]/[course]/assignments"),
	assignment: route("/[discipline]/[course]/assignments/[slug]"),
	attendance: route("/[discipline]/[course]/attendance"),
	grades: route("/[discipline]/[course]/grades"),
	manage: route("/[discipline]/[course]/manage"),
	questions: route("/[discipline]/[course]/questions"),
	question: route("/[discipline]/[course]/questions/[slug]"),
	reports: route("/[discipline]/[course]/reports"),
	repositories: route("/[discipline]/[course]/repositories"),
	repositoryZip: route("/[discipline]/[course]/repositories/[slug].zip"),
	repositoryPath: route(
		"/[discipline]/[course]/repositories/[slug]/[...path]",
		query<{ rotate?: boolean }>(),
	),
	resources: route("/[discipline]/[course]/resources"),
	resource: route("/[discipline]/[course]/resources/[slug]"),
	rollCall: route("/[discipline]/[course]/roll-call/[week]/[timeSlot]"),
	rollCallProject: route(
		"/[discipline]/[course]/roll-call/[week]/[timeSlot]/project",
	),
	roster: route("/[discipline]/[course]/roster"),
	schedule: route("/[discipline]/[course]/schedule"),
	settings: route("/[discipline]/[course]/settings"),
	exams: route("/[discipline]/[course]/exams"),
	exam: {
		index: route("/[discipline]/[course]/exams/[slug]"),
		adjustments: route("/[discipline]/[course]/exams/[slug]/adjustments"),
		attempt: route("/[discipline]/[course]/exams/[slug]/attempts/[username]"),
		exceptions: route("/[discipline]/[course]/exams/[slug]/exceptions"),
		grading: route(
			"/[discipline]/[course]/exams/[slug]/grading",
			query<GradingQuery>(),
		),
		gradingQuestion: route(
			"/[discipline]/[course]/exams/[slug]/grading/[question]",
			query<GradingQuery>(),
		),
		preview: route("/[discipline]/[course]/exams/[slug]/preview"),
		regrades: route("/[discipline]/[course]/exams/[slug]/regrades"),
		results: route("/[discipline]/[course]/exams/[slug]/results"),
	},
} as const;

/** The URLs of the pages of one exam, as `urls.course(ref).exam(slug)` builds them. */
export type ExamUrls = ReturnType<ReturnType<typeof courseUrls>["exam"]>;

/** The URLs of the pages of one course, as `urls.course(ref)` builds them. */
export type CourseUrls = ReturnType<typeof courseUrls>;

/**
 * The URLs of the pages of the course `ref`, each a function that takes the
 * slugs below the course and the page's query.
 *
 * @example
 * const course = urls.course({ discipline: "cs101", instructor: "ana", edition: "2026-1" });
 * course.index(); // "/cs101/ana_2026-1"
 * course.resource("intro"); // "/cs101/ana_2026-1/resources/intro"
 * course.exam("p1").grading({ names: true }); // "/cs101/ana_2026-1/exams/p1/grading?names=1"
 */
function courseUrls(ref: CourseRef) {
	const at = {
		discipline: ref.discipline,
		course: `${ref.instructor}_${ref.edition}`,
	};
	const r = courseRoutes;
	const e = r.exam;
	return {
		index: (q?: { joined?: boolean }) => r.index(at, q),
		assignments: () => r.assignments(at),
		assignment: (slug: string) => r.assignment({ ...at, slug }),
		attendance: () => r.attendance(at),
		grades: () => r.grades(at),
		manage: () => r.manage(at),
		questions: () => r.questions(at),
		question: (slug: string) => r.question({ ...at, slug }),
		reports: () => r.reports(at),
		repositories: () => r.repositories(at),
		repositoryZip: (slug: string) => r.repositoryZip({ ...at, slug }),
		/// A file or directory of a repository; `path` is its segments, empty for the root.
		repository: (
			slug: string,
			path: readonly string[] = [],
			q?: { rotate?: boolean },
		) => r.repositoryPath({ ...at, slug, path }, q),
		resources: () => r.resources(at),
		resource: (slug: string) => r.resource({ ...at, slug }),
		rollCall: (week: number | string, timeSlot: string) =>
			r.rollCall({ ...at, week: String(week), timeSlot }),
		rollCallProject: (week: number | string, timeSlot: string) =>
			r.rollCallProject({ ...at, week: String(week), timeSlot }),
		roster: () => r.roster(at),
		schedule: () => r.schedule(at),
		settings: () => r.settings(at),
		exams: () => r.exams(at),
		exam: (slug: string) => {
			const x = { ...at, slug };
			return {
				index: () => e.index(x),
				adjustments: () => e.adjustments(x),
				attempt: (username: string) => e.attempt({ ...x, username }),
				exceptions: () => e.exceptions(x),
				grading: (q?: GradingQuery) => e.grading(x, q),
				gradingQuestion: (question: string, q?: GradingQuery) =>
					e.gradingQuestion({ ...x, question }, q),
				preview: () => e.preview(x),
				regrades: () => e.regrades(x),
				results: () => e.results(x),
			};
		},
	};
}
