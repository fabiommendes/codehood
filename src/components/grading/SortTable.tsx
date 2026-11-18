import { createMemo, createSignal, type JSX } from "solid-js";
import Table, {
	type ColumnConfig,
	type TableProps,
	type TableSort,
} from "@/components/ui/Table";
import { compareNullsLast } from "@/components/ui/table-sort";

/// A column that sorts by the value `sortValue` reads off a row.
export interface SortColumn<T> extends ColumnConfig<T> {
	sortValue?: (row: T) => number | string | null;
}

type Props<T> = Omit<TableProps<T>, "columns" | "sort" | "onSort"> & {
	columns: SortColumn<T>[];
};

/** The app's `Table` with the click-to-sort state kept in the island, for pages that have no URL to keep it in. */
export default function SortTable<T>(props: Props<T>): JSX.Element {
	const [sort, setSort] = createSignal<TableSort | undefined>();
	const rows = createMemo(() => {
		const current = sort();
		const column = props.columns.find((c) => c.sortKey === current?.key);
		if (!current || !column?.sortValue) return props.data;
		const read = column.sortValue;
		return [...props.data].sort((a, b) =>
			compareNullsLast(read(a), read(b), current.direction, (x, y) =>
				typeof x === "number" && typeof y === "number"
					? x - y
					: String(x).localeCompare(String(y), undefined),
			),
		);
	});
	return (
		<Table
			{...props}
			data={rows()}
			sort={sort()}
			onSort={(key) =>
				setSort((current) =>
					current?.key === key
						? { key, direction: current.direction === "asc" ? "desc" : "asc" }
						: { key, direction: "asc" },
				)
			}
		/>
	);
}
