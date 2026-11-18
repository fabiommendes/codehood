import { type JSX, Show } from "solid-js";
import { m } from "@/i18n";
import type { OrderingMatrix as Matrix } from "@/services/objective-review";
import SortTable from "./SortTable";

/// One step of the key and how many answers put it at each position.
interface Row {
	step: string;
	index: number;
	/// Count per position, in position order.
	cells: number[];
}

/**
 * Steps by position: the diagonal is the key, the redder an off-diagonal cell the more students erred that way.
 */
export default function OrderingMatrix(props: { matrix: Matrix }): JSX.Element {
	const rows = (): Row[] =>
		props.matrix.steps.map((step, index) => ({
			step,
			index,
			cells: props.matrix.cells[index] ?? [],
		}));
	return (
		<SortTable
			label={m.grades_objective_matrix_label()}
			tableClass="table-sm"
			class="w-fit max-w-full"
			data={rows()}
			columns={[
				{
					title: m.grades_objective_step(),
					class: "font-medium",
					sortKey: "step",
					sortValue: (row: Row) => row.index,
					render: (row: Row) => `${row.index + 1}. ${row.step}`,
				},
				...props.matrix.steps.map((_, position) => ({
					title: `${position + 1}º`,
					class: "p-0",
					headerClass: "text-center",
					render: (row: Row) => {
						const count = row.cells[position] ?? 0;
						const pct = Math.round(
							(count / Math.max(1, props.matrix.answers)) * 100,
						);
						const diagonal = row.index === position;
						const color = diagonal ? "--color-success" : "--color-error";
						return (
							<div
								class="px-4 py-3 text-center tabular-nums"
								style={{
									background: `color-mix(in oklab, var(${color}) ${count === 0 ? 0 : 12 + pct * 0.7}%, transparent)`,
									outline: diagonal ? "2px solid var(--color-success)" : "none",
									"outline-offset": "-2px",
								}}
							>
								<Show
									when={count > 0}
									fallback={<span class="text-muted">·</span>}
								>
									{count} <span class="text-xs text-muted">{pct}%</span>
								</Show>
							</div>
						);
					},
				})),
			]}
		/>
	);
}
