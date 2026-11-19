import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { TEST_BASE_URL } from "../env";
import { expect, test } from "../fixtures";
import { logInAs } from "../stories/helpers";
import {
	routeLimit,
	TOUR_DIR,
	TOUR_IGNORED_PREFIXES,
	TOUR_MAX_TILES,
	TOUR_MAX_VISITS,
	TOUR_ROLES,
	TOUR_VIEWPORT,
	type TourRole,
	type TourVisit,
} from "./config";
import { discoverRoutes, matchRoute, type Route, routeSlug } from "./routes";
import { dynamicStarts } from "./starts";

/// Statuses that Astro answers with an error page of its own.
const ERROR_PAGES: Record<number, string> = {
	403: "/403",
	404: "/404",
	500: "/500",
};

/// How long a page may keep the network busy before the shot is taken anyway.
const SETTLE_MS = 3000;

const routes = discoverRoutes();

test.use({ viewport: TOUR_VIEWPORT });
test.describe.configure({ mode: "parallel" });

/// The route that rendered what the browser shows: an error status means the
/// error page did, whatever the URL.
function renderedRoute(status: number | null, pathname: string): Route | null {
	const errorPattern = status === null ? undefined : ERROR_PAGES[status];
	const errorRoute = routes.find((route) => route.pattern === errorPattern);
	return errorRoute ?? matchRoute(routes, pathname) ?? null;
}

function ignored(pathname: string): boolean {
	return Object.keys(TOUR_IGNORED_PREFIXES).some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

/// The names of the query parameters of `url`, sorted: a view of the page
/// (`?view=list`) is a variant of its route with a budget of its own.
function variantOf(url: URL): string {
	const keys = [...new Set(url.searchParams.keys())].sort();
	return keys.length > 0 ? `@${keys.join(",")}` : "";
}

/// Same-origin links of the page, with their query but without fragment.
async function links(page: Page, origin: string): Promise<string[]> {
	const hrefs = await page.$$eval("a[href]", (anchors) =>
		anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
	);
	return hrefs.flatMap((href) => {
		const url = new URL(href);
		return url.origin === origin ? [url.pathname + url.search] : [];
	});
}

/// Viewport-sized screenshots of the whole page, top first.
async function screenshots(page: Page, dir: string): Promise<number> {
	const height = await page.evaluate(
		() => document.documentElement.scrollHeight,
	);
	const { width, height: tile } = TOUR_VIEWPORT;
	const count = Math.min(Math.ceil(height / tile), TOUR_MAX_TILES);
	for (let index = 0; index < count; index++) {
		const y = index * tile;
		await page.screenshot({
			path: path.join(dir, `${String(index + 1).padStart(2, "0")}.png`),
			fullPage: true,
			animations: "disabled",
			clip: { x: 0, y, width, height: Math.min(tile, height - y) },
		});
	}
	return count;
}

async function tour(
	page: Page,
	role: TourRole,
	start: string[],
): Promise<TourVisit[]> {
	const origin = new URL(TEST_BASE_URL).origin;
	const roleDir = path.join(TOUR_DIR, role.name);
	const queue = [...start];
	const seen = new Set<string>();
	const perRoute = new Map<string, number>();
	const dirs = new Map<string, number>();
	const visits: TourVisit[] = [];

	let consoleErrors: string[] = [];
	let pageErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));

	while (queue.length > 0 && visits.length < TOUR_MAX_VISITS) {
		const target = queue.shift() as string;
		if (seen.has(target)) continue;
		seen.add(target);
		const asked = new URL(target, origin);
		const pathname = asked.pathname;
		if (ignored(pathname)) continue;
		const isStart = start.includes(target);
		const wanted = matchRoute(routes, pathname);
		if (!isStart && wanted?.kind !== "page") continue;
		const wantedKey = wanted && wanted.pattern + variantOf(asked);
		if (
			wanted &&
			wantedKey &&
			(perRoute.get(wantedKey) ?? 0) >= routeLimit(wanted.pattern)
		) {
			continue;
		}

		consoleErrors = [];
		pageErrors = [];
		const response = await page.goto(target);
		await page
			.waitForLoadState("networkidle", { timeout: SETTLE_MS })
			.catch(() => {});
		const status = response?.status() ?? null;
		const final = new URL(page.url());
		const route = renderedRoute(status, final.pathname);
		// A redirect may land on a page the crawl already took.
		const landed = final.pathname + final.search;
		if (landed !== target && seen.has(landed)) continue;
		seen.add(landed);
		const variant = variantOf(final);
		const counted = (route?.pattern ?? final.pathname) + variant;
		perRoute.set(counted, (perRoute.get(counted) ?? 0) + 1);

		const slug = (route ? routeSlug(route.pattern) : "unmatched") + variant;
		const taken = (dirs.get(slug) ?? 0) + 1;
		dirs.set(slug, taken);
		const name = taken === 1 ? slug : `${slug}~${taken}`;
		const dir = path.join(roleDir, name);
		mkdirSync(dir, { recursive: true });

		const tiles = await screenshots(page, dir);
		const aria = await page
			.locator("body")
			.ariaSnapshot({ timeout: 10_000 })
			.catch((error: Error) => `# aria snapshot failed: ${error.message}`);
		writeFileSync(path.join(dir, "aria.yml"), `${aria}\n`);

		const visit: TourVisit = {
			role: role.name,
			url: target,
			finalUrl: final.pathname + final.search,
			status,
			route: route?.pattern ?? null,
			requestedRoute: wanted?.pattern ?? null,
			file: route?.file ?? null,
			title: await page.title(),
			dir: path.relative(TOUR_DIR, dir),
			tiles,
			consoleErrors,
			pageErrors,
		};
		writeFileSync(
			path.join(dir, "meta.json"),
			`${JSON.stringify(visit, null, "\t")}\n`,
		);
		visits.push(visit);

		for (const link of await links(page, origin)) {
			if (!seen.has(link)) queue.push(link);
		}
	}
	return visits;
}

for (const role of TOUR_ROLES) {
	test(`tour as ${role.name}`, async ({ page }) => {
		test.setTimeout(30 * 60_000);
		if (role.username) await logInAs(page, { username: role.username });
		const start = [...role.start, ...(await dynamicStarts(role.name))];
		const visits = await tour(page, role, start);
		mkdirSync(path.join(TOUR_DIR, role.name), { recursive: true });
		writeFileSync(
			path.join(TOUR_DIR, role.name, "visits.json"),
			`${JSON.stringify(visits, null, "\t")}\n`,
		);

		const broken = visits
			.filter((visit) => (visit.status ?? 0) >= 500 || visit.pageErrors.length)
			.map(
				(visit) =>
					`${visit.url} (${visit.status}): ${visit.pageErrors.join("; ")}`,
			);
		expect(broken, "pages that failed on the server or in the browser").toEqual(
			[],
		);
	});
}
