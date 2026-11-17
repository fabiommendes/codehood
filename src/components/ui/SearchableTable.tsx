import type { JSX } from "solid-js";
import { createMemo, createSignal } from "solid-js";
import { m } from "@/i18n";
import PaginatedTable, { type PaginatedTableProps } from "./PaginatedTable";
import { filterRows } from "./search";

/** Props of {@link SearchableTable}: those of `PaginatedTable`, plus what a row is searched by. */
export interface SearchableTableProps<T>
	extends Omit<PaginatedTableProps<T>, "cursor" | "page" | "onPageChange"> {
	/// The text a row is searched by, usually its fields joined by spaces.
	searchText: (row: T) => string;
	/// The search box's placeholder and accessible name; "Search" by default.
	searchLabel?: string;
	/// Controls shown on the search box's row, at its right.
	children?: JSX.Element;
}

/**
 * A {@link PaginatedTable} with a search box that filters its rows in the
 * browser, so `data` must hold every row.
 *
 * A row matches when its `searchText` holds every word typed, ignoring case
 * and accents. Typing returns the table to its first page.
 *
 * @example
 * <SearchableTable columns={columns} data={students} searchText={(s) => `${s.name} ${s.email}`} />
 */
export default function SearchableTable<T>(
	props: SearchableTableProps<T>,
): JSX.Element {
	const [query, setQuery] = createSignal("");
	const [page, setPage] = createSignal(1);
	const rows = createMemo(() =>
		filterRows(props.data, query(), props.searchText),
	);
	const label = () => props.searchLabel ?? m.common_search();

	return (
		<div class={props.class}>
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
				<label class="input input-sm w-full sm:w-72">
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
						class="text-muted"
					>
						<path
							d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
						/>
					</svg>
					<input
						type="search"
						placeholder={label()}
						aria-label={label()}
						value={query()}
						onInput={(event) => {
							setQuery(event.currentTarget.value);
							setPage(1);
						}}
					/>
				</label>
				{props.children}
			</div>
			<PaginatedTable
				{...props}
				class={undefined}
				data={rows()}
				page={page()}
				onPageChange={setPage}
				empty={
					query().trim() === ""
						? props.empty
						: m.common_table_no_match({ query: query().trim() })
				}
			/>
		</div>
	);
}
