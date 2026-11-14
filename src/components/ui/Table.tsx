import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import { m } from "@/i18n";

/**
 * Describes one column: its header text, how to render a row's cell, and the
 * classes applied to the `<td>` and, separately, the `<th>` — a cell-only
 * emphasis like `font-mono` has no business on the header, so the two are
 * independent rather than one falling back to the other; pass the same value
 * to both (e.g. `text-right`, to keep a numeric column's header and cells
 * aligned) when that's what's wanted. `render` ties the column to `T`, so a
 * column built for the wrong row type is a compile error, not a blank cell.
 */
export interface ColumnConfig<T> {
	title: string;
	class?: string;
	headerClass?: string;
	render: (row: T) => JSX.Element;
	/// Opaque key identifying this column for sorting. Omit to leave the
	/// column's header a plain, unclickable label.
	sortKey?: string;
}

/** The active sort column and direction, keyed by a column's `sortKey`. */
export interface TableSort {
	key: string;
	direction: "asc" | "desc";
}

interface TableProps<T> {
	columns: ColumnConfig<T>[];
	data: T[];
	class?: string;
	/// The table's accessible name, for when no visible caption labels it.
	label?: string;
	/// Lifts the table off the page with a subtle drop shadow; on by default.
	shadow?: boolean;
	/// What the body shows when `data` is empty; a generic "nothing to show" by default.
	empty?: JSX.Element;
	/** Current sort state; drives the direction indicator and `aria-sort` on the active header. */
	sort?: TableSort;
	/** Called with a column's `sortKey` when that column's header is clicked; headers stay plain while `data` has fewer than two rows. */
	onSort?: (key: string) => void;
}

/**
 * A `<table>` driven entirely by data: callers hand it `columns` (what each
 * column is called and how to render a cell) and `data` (the rows), instead
 * of hand-writing `<tr>`/`<td>` per page. `T` is inferred from `data`, so
 * `columns` and `data` are checked against the same row type.
 */
export default function Table<T>(props: TableProps<T>): JSX.Element {
	const containerClass = () =>
		[
			"overflow-x-auto rounded-box border border-base-300 bg-base-100",
			props.shadow !== false && "shadow-sm",
			props.class,
		]
			.filter(Boolean)
			.join(" ");

	return (
		<div class={containerClass()}>
			<table class="table" aria-label={props.label}>
				<thead class="bg-base-200/50">
					<tr class="uppercase">
						<For each={props.columns}>
							{(column) => {
								const sortable = () =>
									column.sortKey !== undefined &&
									props.onSort !== undefined &&
									props.data.length > 1;
								const active = () =>
									sortable() && props.sort?.key === column.sortKey;
								return (
									<th
										class={column.headerClass}
										aria-sort={
											active()
												? props.sort?.direction === "asc"
													? "ascending"
													: "descending"
												: undefined
										}
									>
										<Show when={sortable()} fallback={column.title}>
											<button
												type="button"
												class="inline-flex items-center gap-1"
												onClick={() => {
													if (column.sortKey !== undefined) {
														props.onSort?.(column.sortKey);
													}
												}}
											>
												{column.title}
												<Show when={active()}>
													<span aria-hidden="true">
														{props.sort?.direction === "asc" ? "▲" : "▼"}
													</span>
												</Show>
											</button>
										</Show>
									</th>
								);
							}}
						</For>
					</tr>
				</thead>
				<tbody>
					<For
						each={props.data}
						fallback={
							<tr>
								<td
									colSpan={props.columns.length}
									class="py-6 text-center text-sm text-muted"
								>
									{props.empty ?? m.common_table_empty()}
								</td>
							</tr>
						}
					>
						{(row) => (
							<tr>
								<For each={props.columns}>
									{(column) => (
										<td class={column.class}>{column.render(row)}</td>
									)}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
}
