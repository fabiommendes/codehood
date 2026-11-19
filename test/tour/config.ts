import path from "node:path";

/** Someone the tour browses the app as. */
export interface TourRole {
	name: string;
	/// The account the tour signs in with, or none for a visitor.
	username?: string;
	/// Where the crawl starts. Links found on these pages lead to the rest.
	/// URLs that need a token or a code come from `starts.ts`.
	start: string[];
}

/// The accounts come from the seed (`src/db/bootstrap.ts`): `ada` teaches the
/// live cs101 and the ended one, `student` is enrolled in cs101 and cs201.
export const TOUR_ROLES: TourRole[] = [
	{ name: "visitor", start: ["/", "/login", "/a/page/that/does/not/exist"] },
	{ name: "student", username: "student", start: ["/home", "/profile"] },
	{ name: "instructor", username: "ada", start: ["/home", "/profile"] },
	// `bob` has a team with deliveries in the seeded assignments; `student` has none.
	{ name: "team-student", username: "bob", start: ["/home"] },
	{
		name: "admin",
		username: "admin",
		start: ["/home", "/admin", "/api/docs", "/rpc/docs"],
	},
];

/// Page routes the tour does not have to reach, each with the reason. A page
/// route that is neither reached nor listed here fails the tour.
export const TOUR_SKIPPED: Record<string, string> = {
	"/500": "only renders when the server fails",
};

/// Route prefixes the crawl never follows. Their pages are not screens of the
/// product, and they render many components with fixtures, which would hide
/// the components no real screen reaches.
export const TOUR_IGNORED_PREFIXES: Record<string, string> = {
	"/design": "design showcase and playground",
};

/// Most URLs the tour opens for one route and one role, so a route with one
/// page per student does not take over the run.
export const TOUR_PER_ROUTE = Number(process.env.TOUR_PER_ROUTE ?? 2);

/// Routes that get more URLs than `TOUR_PER_ROUTE`: each seeded exam is one
/// moment of its lifecycle, and each question type grades differently.
export const TOUR_ROUTE_LIMITS: Record<string, number> = {
	"/[discipline]/[course]/assignments/[slug]": 4,
	"/[discipline]/[course]/exams/[slug]": 20,
	"/[discipline]/[course]/exams/[slug]/results": 20,
	"/[discipline]/[course]/exams/[slug]/grading/[question]": 12,
};

/** How many URLs the tour opens for `pattern`, per role. */
export function routeLimit(pattern: string): number {
	return TOUR_ROUTE_LIMITS[pattern] ?? TOUR_PER_ROUTE;
}

/// Most pages one role opens.
export const TOUR_MAX_VISITS = Number(process.env.TOUR_MAX_VISITS ?? 300);

export const TOUR_VIEWPORT = { width: 1280, height: 800 };

/// Most viewport-sized screenshots taken of one page, top first.
export const TOUR_MAX_TILES = Number(process.env.TOUR_MAX_TILES ?? 6);

/// Where this tour writes. `scripts/tour.ts` sets it to `tmp/tour/<time>`.
export const TOUR_DIR = path.resolve(
	process.env.TOUR_DIR ?? path.join("tmp", "tour", "manual"),
);

/** What the tour records of one page it opened. */
export interface TourVisit {
	role: string;
	/// The URL the crawl asked for.
	url: string;
	/// Where the browser landed, after redirects.
	finalUrl: string;
	status: number | null;
	/// The route that rendered the page, or none when no file matches.
	route: string | null;
	/// The route of `url`, which differs from `route` after a redirect.
	requestedRoute: string | null;
	file: string | null;
	title: string;
	/// Directory of the screenshots and snapshot, relative to the tour.
	dir: string;
	tiles: number;
	consoleErrors: string[];
	pageErrors: string[];
}
