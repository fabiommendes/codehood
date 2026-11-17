import type { JSX } from "solid-js";
import Icon from "./_Icon";
import SortTable from "./_SortTable";

/// A grade changed by hand, with the student already shown by number or name.
export interface OverrideItem {
	name: string;
	kind: "Nota alterada" | "Sanção";
	auto: number;
	final: number;
	comment: string;
	when: string;
}

/// The grades changed by hand, one row each, with buttons to change or undo.
export default function Overrides(props: {
	rows: OverrideItem[];
}): JSX.Element {
	return (
		<SortTable
			label="Notas alteradas à mão"
			data={props.rows}
			columns={[
				{
					title: "Aluno",
					class: "whitespace-nowrap font-medium",
					sortKey: "name",
					sortValue: (r) => r.name,
					render: (r) => r.name,
				},
				{
					title: "Tipo",
					class: "whitespace-nowrap",
					sortKey: "kind",
					sortValue: (r) => r.kind,
					render: (r) => (
						<span
							class={`badge badge-sm ${r.kind === "Sanção" ? "badge-error badge-soft" : "badge-info badge-soft"}`}
						>
							{r.kind}
						</span>
					),
				},
				{
					title: "Nota",
					class: "whitespace-nowrap tabular-nums",
					sortKey: "final",
					sortValue: (r) => r.final,
					render: (r) => (
						<>
							<span class="text-muted line-through">{r.auto}%</span> → {r.final}
							%
						</>
					),
				},
				{
					title: "Comentário",
					class: "text-muted",
					sortKey: "comment",
					sortValue: (r) => r.comment,
					render: (r) => r.comment,
				},
				{
					title: "Quando",
					class: "text-muted text-xs whitespace-nowrap",
					sortKey: "when",
					sortValue: (r) => r.when,
					render: (r) => r.when,
				},
				{
					get title() {
						return <span class="sr-only">Ações</span>;
					},
					class: "text-right whitespace-nowrap",
					render: () => (
						<span class="flex justify-end gap-2">
							<button
								type="button"
								class="btn btn-ghost btn-sm btn-square"
								aria-label="Alterar nota"
								title="Alterar nota"
							>
								<Icon name="pencil" />
							</button>
							<button
								type="button"
								class="btn btn-ghost btn-sm btn-square text-error"
								aria-label="Desfazer"
								title="Desfazer"
							>
								<Icon name="undo" />
							</button>
						</span>
					),
				},
			]}
		/>
	);
}
