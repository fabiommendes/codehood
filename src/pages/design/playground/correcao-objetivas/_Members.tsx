import { createSignal, type JSX, Show } from "solid-js";
import Icon from "./_Icon";
import SortTable from "./_SortTable";

/// One student of a group: the auto score, the instructor's score when changed, and what was written.
export interface MemberRow {
	id: number;
	name: string;
	auto: number;
	manual?: number;
	detail?: string;
	/// Mean exam score of the student on the other questions, 0 to 100.
	avg: number;
}

interface Props {
	rows: MemberRow[];
	/// Column title of what the student wrote.
	detailTitle?: string;
	/// Extra explanation under the change form.
	note?: string;
}

/// The students of a group in a sortable table; "Alterar nota" opens the form for one of them under the table.
export default function Members(props: Props): JSX.Element {
	const [selected, setSelected] = createSignal<number | null>(null);
	const row = () => props.rows.find((r) => r.id === selected());
	return (
		<div class="flex flex-col gap-3">
			<SortTable
				label="Alunos do grupo"
				class="max-h-96 overflow-y-auto"
				data={props.rows}
				rowClass={(r) => (r.id === selected() ? "bg-info/10" : undefined)}
				columns={[
					{
						title: "Aluno",
						class: "font-medium",
						sortKey: "name",
						sortValue: (r) => r.name,
						render: (r) => r.name,
					},
					...(props.rows.some((r) => r.detail !== undefined)
						? [
								{
									title: props.detailTitle ?? "Resposta",
									class: "text-muted",
									sortKey: "detail",
									sortValue: (r: MemberRow) => r.detail ?? null,
									render: (r: MemberRow) => r.detail ?? "",
								},
							]
						: []),
					{
						title: "Média nas outras",
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "avg",
						sortValue: (r: MemberRow) => r.avg,
						render: (r: MemberRow) => `${r.avg}%`,
					},
					{
						title: "Nota",
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "score",
						sortValue: (r) => r.manual ?? r.auto,
						render: (r) => (
							<Show when={r.manual !== undefined} fallback={`${r.auto}%`}>
								<span class="text-muted line-through">{r.auto}%</span>{" "}
								{r.manual}%{" "}
								<span class="badge badge-info badge-soft badge-xs">
									alterada
								</span>
							</Show>
						),
					},
					{
						get title() {
							return <span class="sr-only">Ação</span>;
						},
						class: "text-right",
						render: (r) => (
							<button
								type="button"
								class="btn btn-ghost btn-sm btn-square"
								aria-label="Alterar nota"
								title="Alterar nota"
								aria-pressed={selected() === r.id}
								onClick={() => setSelected(selected() === r.id ? null : r.id)}
							>
								<Icon name="pencil" />
							</button>
						),
					},
				]}
			/>
			<Show when={row()}>
				{(r) => (
					<form class="flex flex-wrap items-end gap-3 rounded-box border border-edge bg-base-200/40 px-4 py-3">
						<p class="w-full text-sm font-medium">{r().name}</p>
						<label class="flex flex-col gap-1 text-xs text-muted">
							Nota (0 a 100)
							<input
								type="number"
								min="0"
								max="100"
								value={r().manual ?? r().auto}
								class="input input-sm w-24 text-base-content"
							/>
						</label>
						<button type="button" class="btn btn-success btn-soft btn-sm">
							Marcar como certa
						</button>
						<label class="flex min-w-48 grow flex-col gap-1 text-xs text-muted">
							Comentário (opcional)
							<input
								type="text"
								class="input input-sm w-full text-base-content"
							/>
						</label>
						<button type="button" class="btn btn-primary btn-sm">
							Salvar
						</button>
						<button
							type="button"
							class="btn btn-ghost btn-sm"
							onClick={() => setSelected(null)}
						>
							Cancelar
						</button>
						<Show when={props.note}>
							<p class="w-full text-xs text-muted">{props.note}</p>
						</Show>
					</form>
				)}
			</Show>
		</div>
	);
}
