import { readdirSync } from "node:fs";
import path from "node:path";

/** One file under `src/pages/`, as the router sees it. */
export interface Route {
	/// Path of the file, relative to the repository root.
	file: string;
	/// The route as Astro writes it, e.g. `/[discipline]/[course]/exams/[slug]`.
	pattern: string;
	/// `page` for an `.astro` screen, `endpoint` for a `.ts` handler.
	kind: "page" | "endpoint";
	regex: RegExp;
	/// Sort key: per segment, 0 static, 1 static mixed with a parameter, 2 a
	/// parameter, 3 a rest parameter. Lower wins.
	rank: number[];
}

/// The directory Astro reads routes from.
export const PAGES_DIR = "src/pages";

const PAGE_EXTENSIONS = /\.(astro|ts)$/;

function pageFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		// Astro ignores files and directories whose name starts with `_`.
		if (entry.name.startsWith("_")) return [];
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return pageFiles(full);
		return PAGE_EXTENSIONS.test(entry.name) ? [full] : [];
	});
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// The regex source and rank of one path segment.
function segment(text: string): { source: string; rank: number } {
	const rest = /^\[\.\.\.\w+\]$/.exec(text);
	if (rest) return { source: "(?:/.*)?", rank: 3 };
	const parts = text.split(/(\[\w+\])/).filter(Boolean);
	const params = parts.filter((part) => /^\[\w+\]$/.test(part)).length;
	const source = parts
		.map((part) => (/^\[\w+\]$/.test(part) ? "[^/]+" : escapeRegex(part)))
		.join("");
	const rank = params === 0 ? 0 : parts.length === params ? 2 : 1;
	return { source: `/${source}`, rank };
}

/**
 * Turns a file under `src/pages/` into its route.
 *
 * @example
 * routeOf("src/pages/[discipline]/[course]/exams/index.astro").pattern
 * // "/[discipline]/[course]/exams"
 */
export function routeOf(file: string): Route {
	const relative = path.relative(PAGES_DIR, file).split(path.sep).join("/");
	const kind = relative.endsWith(".astro") ? "page" : "endpoint";
	const withoutExtension = relative.replace(PAGE_EXTENSIONS, "");
	const segments = withoutExtension.split("/");
	if (segments.at(-1) === "index") segments.pop();
	const compiled = segments.map(segment);
	const pattern = `/${segments.join("/")}`;
	const source = compiled.map((part) => part.source).join("");
	return {
		file: path.join(PAGES_DIR, relative),
		pattern,
		kind,
		regex: new RegExp(`^${source || "/"}/?$`),
		rank: compiled.map((part) => part.rank),
	};
}

function compareRank(a: number[], b: number[]): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		const difference = (a[i] ?? 0) - (b[i] ?? 0);
		if (difference !== 0) return difference;
	}
	return b.length - a.length;
}

/** Every route under `src/pages/`, the most specific first. */
export function discoverRoutes(dir: string = PAGES_DIR): Route[] {
	return pageFiles(dir)
		.map(routeOf)
		.sort((a, b) => compareRank(a.rank, b.rank));
}

/**
 * The route that serves `pathname`, picked as Astro does: a static segment
 * wins over a parameter, and a parameter over a rest parameter.
 */
export function matchRoute(
	routes: readonly Route[],
	pathname: string,
): Route | undefined {
	const decoded = safeDecode(pathname);
	return routes.find((route) => route.regex.test(decoded));
}

function safeDecode(pathname: string): string {
	try {
		return decodeURI(pathname);
	} catch {
		return pathname;
	}
}

/**
 * A directory name for `pattern`: its segments joined by dots, `index` for `/`.
 *
 * @example
 * routeSlug("/[discipline]/[course]/exams/[slug]") // "[discipline].[course].exams.[slug]"
 */
export function routeSlug(pattern: string): string {
	const slug = pattern.split("/").filter(Boolean).join(".");
	return slug.replace(/\.\.\./g, "…") || "index";
}
