import { InvalidData } from "@/core/error";
import {
	PAGE_LIMIT_MAX,
	type Page,
	type PageParams,
} from "@/core/schemas/page";
import { cursorParams } from "./page-links";

/// Rows a list page shows when its URL names no `limit`.
export const LIST_PAGE_SIZE = 50;

/**
 * The page size a list page URL asks for in `limit`, kept within what a
 * paginated list accepts.
 *
 * @example
 * pageLimit(new URL("http://x/admin/users?limit=2")); // 2
 * pageLimit(new URL("http://x/admin/users?limit=9999")); // 500
 * pageLimit(new URL("http://x/admin/users?limit=many")); // 50
 */
export function pageLimit(url: URL): number {
	const asked = url.searchParams.get("limit") ?? "";
	if (!/^\d+$/.test(asked)) return LIST_PAGE_SIZE;
	return Math.min(Math.max(Number(asked), 1), PAGE_LIMIT_MAX);
}

/**
 * The URL of the list page a request reached, without the action a form
 * posted to it, so the links built from it are plain reads.
 */
export function listUrl(url: URL): URL {
	const plain = new URL(url);
	plain.searchParams.delete("_action");
	return plain;
}

/**
 * The target of a form that posts `action` to a list page and comes back to
 * the same place in the list.
 *
 * @example
 * <form method="post" action={actionHref(actions.admin.createUser, listUrl(Astro.url).search)}>
 *
 * @param search The query of the list page, as `listUrl(url).search`.
 */
export function actionHref(
	action: { toString(): string },
	search: string,
): string {
	const kept = search.replace(/^\?/, "");
	return kept ? `${action}&${kept}` : `${action}`;
}

/**
 * Reads the page of a list that `url` asks for with `limit`, `after` and
 * `before`.
 *
 * A cursor the list cannot read, or whose page has no rows left, answers the
 * first page instead: a reader who follows a stale link still gets a list,
 * and an empty page carries no link out of it.
 *
 * @example
 * const page = await readPage(Astro.url, (params) => db.course.findPage(params, { actor }));
 */
export async function readPage<Item>(
	url: URL,
	find: (params: PageParams) => Promise<Page<Item>>,
): Promise<Page<Item>> {
	const limit = pageLimit(url);
	const cursor = cursorParams(url);
	if (cursor.after === undefined && cursor.before === undefined)
		return find({ limit });
	try {
		const page = await find({ limit, ...cursor });
		if (page.items.length > 0) return page;
	} catch (error) {
		if (!(error instanceof InvalidData)) throw error;
	}
	return find({ limit });
}
