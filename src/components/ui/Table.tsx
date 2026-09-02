import type { JSX } from "solid-js";
import { For } from "solid-js";

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
}

interface TableProps<T> {
	columns: ColumnConfig<T>[];
	data: T[];
	class?: string;
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
			props.class,
		]
			.filter(Boolean)
			.join(" ");

	return (
		<div class={containerClass()}>
			<table class="table">
				<thead>
					<tr class="uppercase">
						<For each={props.columns}>
							{(column) => <th class={column.headerClass}>{column.title}</th>}
						</For>
					</tr>
				</thead>
				<tbody>
					<For each={props.data}>
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
