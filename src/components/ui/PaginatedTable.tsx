import type { JSX } from "solid-js";
import { createEffect, createSignal, on, Show } from "solid-js";
import { locale, m } from "@/i18n";
import Pagination, { type CursorPage, CursorPagination } from "./Pagination";
import {
	clampPage,
	DEFAULT_PAGE_SIZE,
	pageCount,
	pageRange,
} from "./pagination";
import Table, { type TableProps } from "./Table";

/** Props of {@link PaginatedTable}: those of `Table`, plus how its rows are paged. */
export interface PaginatedTableProps<T> extends TableProps<T> {
	/// Rows per page when `data` holds every row; 50 by default.
	pageSize?: number;
	/// The current page, 1-based, for a caller that keeps it (e.g. in the URL);
	/// left out, the table keeps the page itself.
	page?: number;
	/// Called with the page the reader picks; a controlled `page` must follow it.
	onPageChange?: (page: number) => void;
	/**
	 * Links to the neighbouring pages when the server pages the rows: `data`
	 * is then the current page only, shown as is, and `pageSize`, `page` and
	 * `onPageChange` are ignored.
	 */
	cursor?: CursorPage;
}

/**
 * A {@link Table} that shows its rows one page at a time.
 *
 * Given every row in `data`, it slices them in the browser and offers a
 * numbered pager; it returns to the first page when `sort` changes, since
 * the caller sorts `data` before handing it over. Given `cursor`, `data` is
 * one page the server sent, and the pager links to the pages around it.
 *
 * @example
 * <PaginatedTable columns={columns} data={users} pageSize={25} />
 * <PaginatedTable columns={columns} data={page.items} cursor={{ nextHref }} />
 */
export default function PaginatedTable<T>(
	props: PaginatedTableProps<T>,
): JSX.Element {
	const [ownPage, setOwnPage] = createSignal(1);
	const size = () => props.pageSize ?? DEFAULT_PAGE_SIZE;
	const pages = () => pageCount(props.data.length, size());
	const page = () => clampPage(props.page ?? ownPage(), pages());
	const choose = (next: number) => {
		setOwnPage(next);
		props.onPageChange?.(next);
	};

	createEffect(
		on(
			() => [props.sort?.key, props.sort?.direction],
			() => {
				if (page() !== 1) choose(1);
			},
			{ defer: true },
		),
	);

	const rows = () =>
		props.cursor
			? props.data
			: props.data.slice((page() - 1) * size(), page() * size());
	const summary = () => {
		const { from, to } = pageRange(page(), size(), props.data.length);
		return m.common_pagination_range({
			from: from.toLocaleString(locale),
			to: to.toLocaleString(locale),
			total: props.data.length.toLocaleString(locale),
		});
	};

	return (
		<div class={props.class}>
			<Table {...props} class={undefined} data={rows()} />
			<Show
				when={props.cursor}
				fallback={
					<Pagination
						page={page()}
						pageCount={pages()}
						onChange={choose}
						summary={summary()}
					/>
				}
			>
				{(cursor) => <CursorPagination {...cursor()} />}
			</Show>
		</div>
	);
}
