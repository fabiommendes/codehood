import { type JSX, Show } from "solid-js";
import SortTable from "./_SortTable";

/// One step of an ordering question and how many put it at each position.
export interface MatrixRow {
	step: string;
	/// Count per position, in position order.
	cells: number[];
}

/// Steps by position: the diagonal is the key, the redder an off-diagonal cell the more students erred that way.
export function Matrix(props: {
	rows: MatrixRow[];
	total: number;
}): JSX.Element {
	const positions = () => props.rows.map((_, p) => p);
	return (
		<SortTable
			label="Etapa por posição"
			tableClass="table-sm"
			class="w-fit max-w-full"
			data={props.rows}
			columns={[
				{
					title: "Etapa",
					class: "font-medium",
					sortKey: "step",
					sortValue: (r) => props.rows.indexOf(r),
					render: (r) => `${props.rows.indexOf(r) + 1}. ${r.step}`,
				},
				...positions().map((p) => ({
					title: `${p + 1}º`,
					class: "p-0",
					headerClass: "text-center",
					render: (r: MatrixRow) => {
						const n = r.cells[p] ?? 0;
						const pct = Math.round((n / props.total) * 100);
						const diagonal = props.rows.indexOf(r) === p;
						const color = diagonal ? "--color-success" : "--color-error";
						return (
							<div
								class="px-4 py-3 text-center tabular-nums"
								style={{
									background: `color-mix(in oklab, var(${color}) ${n === 0 ? 0 : 12 + pct * 0.7}%, transparent)`,
									outline: diagonal ? "2px solid var(--color-success)" : "none",
									"outline-offset": "-2px",
								}}
							>
								<Show when={n > 0} fallback={<span class="text-muted">·</span>}>
									{n} <span class="text-xs text-muted">{pct}%</span>
								</Show>
							</div>
						);
					},
				})),
			]}
		/>
	);
}
