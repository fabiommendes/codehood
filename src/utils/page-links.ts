import type { CursorPage } from "@/components/ui/Pagination";
import type { Page } from "@/core/schemas";

/**
 * The links a cursor pager follows from `url` to the pages around `page`.
 *
 * Every other query parameter of `url` is kept, so filters and sorting
 * survive the step.
 *
 * @example
 * const page = await db.course.findPage({ limit: 50, ...cursorParams(Astro.url) }, { actor });
 * <PaginatedTable data={page.items} cursor={{ ...pageLinks(Astro.url, page), total }} />
 */
export function pageLinks(
	url: URL,
	page: Pick<Page<unknown>, "next" | "prev">,
): Pick<CursorPage, "prevHref" | "nextHref"> {
	const link = (param: "after" | "before", cursor: string | null) => {
		if (cursor === null) return undefined;
		const query = new URLSearchParams(url.search);
		query.delete("after");
		query.delete("before");
		query.set(param, cursor);
		return `${url.pathname}?${query}`;
	};
	return {
		prevHref: link("before", page.prev),
		nextHref: link("after", page.next),
	};
}

/** The cursor a page URL asks for, as the `after` or `before` of a `findPage` filter. */
export function cursorParams(url: URL): { after?: string; before?: string } {
	const after = url.searchParams.get("after") || undefined;
	const before = url.searchParams.get("before") || undefined;
	return before !== undefined ? { before } : { after };
}
