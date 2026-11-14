import { type ZodType, z } from "zod";
// Patches zod with `.openapi(...)`.
import "./base";

/// Rows a paginated list answers when the request names no `limit`.
export const PAGE_LIMIT_DEFAULT = 100;
/// Most rows a paginated list answers at once.
export const PAGE_LIMIT_MAX = 500;

/// What a paginated list takes besides its filter. `after` and `before` exclude each other.
export const pageParams = z.object({
	/// Size of the page.
	limit: z.number().int().min(1).max(PAGE_LIMIT_MAX).optional(),
	/// The `next` of the page before the one wanted.
	after: z.string().min(1).optional(),
	/// The `prev` of the page after the one wanted.
	before: z.string().min(1).optional(),
});
export type PageParams = z.infer<typeof pageParams>;

/// One page of a list, in the order of the list whichever way it was reached.
/// `next` is the `after` that asks for the following page and `prev` the
/// `before` that asks for the one behind; each is null where the list ends.
export type Page<Item> = {
	items: Item[];
	next: string | null;
	prev: string | null;
};

/** The schema of a {@link Page} of `item`. */
export function pageOf<Item>(item: ZodType<Item>): ZodType<Page<Item>> {
	return z.object({
		items: item.array(),
		next: z.string().nullable(),
		prev: z.string().nullable(),
	});
}
