import { createMemo, createSignal, type JSX } from "solid-js";
import PaginatedTable from "@/components/ui/PaginatedTable";
import type { ColumnConfig, TableSort } from "@/components/ui/Table";

interface Row {
	id: number;
	name: string;
	score: number;
}

/// Made-up rows, enough for several pages.
const ROWS: Row[] = Array.from({ length: 230 }, (_, i) => ({
	id: i + 1,
	name: `Student ${String(i + 1).padStart(3, "0")}`,
	score: (i * 37) % 101,
}));

const COLUMNS: ColumnConfig<Row>[] = [
	{ title: "#", class: "font-mono text-muted", render: (row) => row.id },
	{ title: "Name", sortKey: "name", render: (row) => row.name },
	{
		title: "Score",
		sortKey: "score",
		class: "text-right",
		headerClass: "text-right",
		render: (row) => row.score,
	},
];

/** A table paged in the browser over made-up rows, for the design catalogue. */
export default function PaginatedTableDemo(): JSX.Element {
	const [sort, setSort] = createSignal<TableSort>({
		key: "name",
		direction: "asc",
	});
	const rows = createMemo(() => {
		const { key, direction } = sort();
		const sign = direction === "asc" ? 1 : -1;
		return [...ROWS].sort((a, b) =>
			key === "score"
				? sign * (a.score - b.score)
				: sign * a.name.localeCompare(b.name),
		);
	});
	return (
		<PaginatedTable
			columns={COLUMNS}
			data={rows()}
			pageSize={20}
			sort={sort()}
			onSort={(key) =>
				setSort((current) => ({
					key,
					direction:
						current.key === key && current.direction === "asc" ? "desc" : "asc",
				}))
			}
		/>
	);
}
