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
	/// Header content; usually text, markup when the header needs a hint or a link.
	title: JSX.Element;
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

/** Props of {@link Table}; `PaginatedTable` takes the same ones. */
export interface TableProps<T> {
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
	/**
	 * Builds the link a column's header follows to sort by its `sortKey`, for
	 * tables sorted on the server; takes precedence over `onSort`.
	 */
	sortHref?: (key: string) => string;
	/// Classes for the `<table>` itself, such as `min-w-max` for a wide matrix that scrolls.
	tableClass?: string;
	/// Classes for a row, such as dimming one that no longer counts.
	rowClass?: (row: T) => string | undefined;
	/// Classes every body row takes to stand out under the pointer; a light
	/// tint by default, `false` or `""` to turn it off.
	hoverClass?: string | false;
	/// Renders the first column's cells as row headers (`<th scope="row">`).
	rowHeader?: boolean;
	/// Keeps the first column in view while the table scrolls sideways.
	stickyFirst?: boolean;
}

/// The header's tint made opaque, so a sticky header cell hides what scrolls under it.
const STICKY_HEAD =
	"sticky left-0 z-10 bg-[color-mix(in_oklab,var(--color-base-200)_50%,var(--color-base-100))]";
/// A sticky body cell, opaque over what scrolls under it.
const STICKY_CELL = "sticky left-0 z-10 bg-base-100";
/// The default row highlight under the pointer.
const ROW_HOVER = "hover:bg-base-200/40";
/// The same highlight made opaque, for a sticky cell of the hovered row.
const STICKY_CELL_HOVER =
	"group-hover/row:bg-[color-mix(in_oklab,var(--color-base-200)_40%,var(--color-base-100))]";

/// Joins the truthy class names.
const classes = (...names: (string | false | undefined)[]): string =>
	names.filter(Boolean).join(" ");

/**
 * A `<table>` driven entirely by data: callers hand it `columns` (what each
 * column is called and how to render a cell) and `data` (the rows), instead
 * of hand-writing `<tr>`/`<td>` per page. `T` is inferred from `data`, so
 * `columns` and `data` are checked against the same row type.
 */
export default function Table<T>(props: TableProps<T>): JSX.Element {
	const containerClass = () =>
		classes(
			"overflow-x-auto rounded-box border border-base-300 bg-base-100",
			props.shadow !== false && "shadow-sm",
			props.class,
		);
	const sticky = (index: number) => props.stickyFirst === true && index === 0;
	const hover = () =>
		props.hoverClass === undefined ? ROW_HOVER : props.hoverClass;

	return (
		<div class={containerClass()}>
			<table
				class={classes("table", props.tableClass)}
				aria-label={props.label}
			>
				<thead class="bg-base-200/50">
					<tr class="uppercase">
						<For each={props.columns}>
							{(column, index) => {
								const sortable = () =>
									column.sortKey !== undefined &&
									(props.onSort !== undefined ||
										props.sortHref !== undefined) &&
									props.data.length > 1;
								const active = () =>
									sortable() && props.sort?.key === column.sortKey;
								const indicator = () => (
									<Show when={active()}>
										<span aria-hidden="true">
											{props.sort?.direction === "asc" ? "▲" : "▼"}
										</span>
									</Show>
								);
								return (
									<th
										scope="col"
										class={classes(
											sticky(index()) && STICKY_HEAD,
											column.headerClass,
										)}
										aria-sort={
											active()
												? props.sort?.direction === "asc"
													? "ascending"
													: "descending"
												: undefined
										}
									>
										<Show when={sortable()} fallback={column.title}>
											<Show
												when={props.sortHref}
												fallback={
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
														{indicator()}
													</button>
												}
											>
												{(sortHref) => (
													<a
														href={sortHref()(column.sortKey ?? "")}
														class="inline-flex items-center gap-1"
													>
														{column.title}
														{indicator()}
													</a>
												)}
											</Show>
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
							<tr
								class={classes(
									hover() && `group/row ${hover()}`,
									props.rowClass?.(row),
								)}
							>
								<For each={props.columns}>
									{(column, index) => {
										const cellClass = classes(
											sticky(index()) && STICKY_CELL,
											sticky(index()) && hover() && STICKY_CELL_HOVER,
											column.class,
										);
										return props.rowHeader && index() === 0 ? (
											<th scope="row" class={cellClass}>
												{column.render(row)}
											</th>
										) : (
											<td class={cellClass}>{column.render(row)}</td>
										);
									}}
								</For>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
}
