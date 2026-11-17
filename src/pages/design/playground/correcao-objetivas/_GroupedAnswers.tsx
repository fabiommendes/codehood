import { createSignal, createUniqueId, For, type JSX, Show } from "solid-js";
import Dialog, { PeopleButton } from "./_Dialog";
import Members, { type MemberRow } from "./_Members";
import SortTable from "./_SortTable";

/// One box of a combination of marked alternatives.
export interface Check {
	letter: string;
	/// Marked by the students of the row.
	on: boolean;
	/// Part of the answer key.
	key: boolean;
}

/// What the response column shows for one item, by the kind of question.
export type ResponseCell =
	/// A choice of a multiple-choice (radio) or multiple-selection (checkbox) question, green when in the key.
	| { kind: "choice"; marker: "radio" | "checkbox"; key: boolean; text: string }
	/// A combination of alternatives, one box per letter.
	| { kind: "choices"; boxes: Check[]; text: string }
	/// A plain text: a number, a typed answer, a blank's value.
	| { kind: "text"; text: string }
	/// Items to put in order, each right or wrong at its position.
	| { kind: "chips"; chips: { text: string; ok: boolean }[]; text: string }
	/// A true-false statement with the split of who marked true and false.
	| {
			kind: "statement";
			text: string;
			truth: "V" | "F";
			marked: { V: number; F: number };
	  };

/// One item of the grouped table: how many chose it, the score it got and who they are.
export interface GroupedRow {
	/// Unique in the table.
	id: string;
	response: ResponseCell;
	/// Extra line under the response.
	sub?: string;
	/// A typical mistake the item was clustered under.
	tag?: string;
	count: number;
	percent: number;
	/// How many of the students have the grade changed by hand.
	changed: number;
	/// The auto score as a percentage, null when it varies; omit when the item has none.
	score?: number | null;
	/// Mean score of who chose it on the other questions, null under 3 students.
	mean: number | null;
	/// Why the item is worth a second look; its presence shows "revisar" instead of "esperado".
	diagnosis?: string;
	members: MemberRow[];
}

interface Props {
	rows: GroupedRow[];
	responseHeader?: string;
	/// Title of the count column.
	countTitle?: string;
	/// "accepted" turns the score column into a yes/no "Aceita?" column.
	mode?: "score" | "accepted";
	/// Column title of what each student wrote, in the dialog.
	detailTitle?: string;
	note?: string;
}

/// The tone of the share bar: green for what the key accepts.
const barTone = (row: GroupedRow): string => {
	const r = row.response;
	if (r.kind === "choice") return r.key ? "bg-success" : "bg-base-content/30";
	if (row.score === 100) return "bg-success";
	if (row.score === undefined || row.score === null || row.score === 0)
		return "bg-base-content/30";
	return "bg-warning";
};

/// The text that names an item, in the dialog title and the button label.
const nameOf = (row: GroupedRow): string => row.response.text;

/// A real radio or checkbox that shows a state and cannot be changed by mouse or keyboard, at full colour.
function ReadOnlyInput(props: {
	kind: "radio" | "checkbox";
	checked: boolean;
	tone: "success" | "error" | "neutral";
	label?: string;
}): JSX.Element {
	/// Spelled out so Tailwind sees each class.
	const tone = () =>
		({
			"radio-success": "radio-success",
			"radio-error": "radio-error",
			"checkbox-success": "checkbox-success",
			"checkbox-error": "checkbox-error",
			"radio-neutral": "",
			"checkbox-neutral": "",
		})[`${props.kind}-${props.tone}` as const];
	return (
		<input
			type={props.kind}
			class={`${props.kind} ${props.kind}-sm pointer-events-none shrink-0 ${tone()}`}
			checked={props.checked}
			tabindex="-1"
			aria-readonly="true"
			aria-label={props.label}
			onClick={(e) => e.preventDefault()}
			onKeyDown={(e) => e.preventDefault()}
		/>
	);
}

/// A combination of alternatives as a group of boxes with their letters: marked ones green when in the key and red when not, a green outline when in the key and missed.
function Checks(props: { checks: Check[] }): JSX.Element {
	return (
		<span class="flex shrink-0 gap-2">
			<For each={props.checks}>
				{(c) => (
					<span class="inline-flex flex-col items-center gap-0.5 text-xs">
						<ReadOnlyInput
							kind="checkbox"
							checked={c.on}
							tone={
								c.on
									? c.key
										? "success"
										: "error"
									: c.key
										? "success"
										: "neutral"
							}
							label={`${c.letter}${c.on ? ", marcada" : ""}${c.key ? ", no gabarito" : ""}`}
						/>
						<span class="text-muted">{c.letter}</span>
					</span>
				)}
			</For>
		</span>
	);
}

type ChoiceCell = Extract<ResponseCell, { kind: "choice" }>;
type ChoicesCell = Extract<ResponseCell, { kind: "choices" }>;
type ChipsCell = Extract<ResponseCell, { kind: "chips" }>;

/// The bar under the response: the count against the largest item of the table, or the split of true and false for a statement.
function Bar(props: { row: GroupedRow; max: number }): JSX.Element {
	const r = () => props.row.response;
	const marked = () => {
		const cell = r();
		return cell.kind === "statement" ? cell.marked : undefined;
	};
	return (
		<Show
			when={marked()}
			fallback={
				<span class="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-base-200">
					<span
						class={`block h-full ${barTone(props.row)}`}
						style={{
							width: `${(props.row.count / Math.max(1, props.max)) * 100}%`,
						}}
					/>
				</span>
			}
		>
			{(m) => {
				const total = () => m().V + m().F;
				return (
					<span class="mt-1 block w-full">
						<span class="flex h-1.5 overflow-hidden rounded-full bg-base-200">
							<span
								class="bg-success"
								style={{ width: `${(m().V / total()) * 100}%` }}
							/>
							<span
								class="bg-error"
								style={{ width: `${(m().F / total()) * 100}%` }}
							/>
						</span>
						<span class="flex justify-between text-xs tabular-nums text-muted">
							<span>V {m().V}</span>
							<span>F {m().F}</span>
						</span>
					</span>
				);
			}}
		</Show>
	);
}

/// The unified table of a question: item with its share bar, students, score and diagnosis, and the people button that opens the students in a dialog.
export default function GroupedAnswers(props: Props): JSX.Element {
	const id = createUniqueId();
	const [open, setOpen] = createSignal<string | null>(null);
	const group = () => props.rows.find((r) => r.id === open());
	const accepted = () => props.mode === "accepted";
	const maxCount = () => Math.max(...props.rows.map((r) => r.count));
	const hasScore = () => props.rows.some((r) => r.score !== undefined);
	return (
		<>
			<SortTable
				label={props.responseHeader ?? "Respostas"}
				data={props.rows}
				columns={[
					{
						title: props.responseHeader ?? "Resposta",
						sortKey: "response",
						sortValue: (r) => r.response.text,
						render: (r) => (
							<div class="flex items-center gap-3">
								<Show when={r.response.kind === "choice"}>
									<ReadOnlyInput
										kind={(r.response as ChoiceCell).marker}
										checked={(r.response as ChoiceCell).key}
										tone={
											(r.response as ChoiceCell).key ? "success" : "neutral"
										}
										label={
											(r.response as ChoiceCell).key
												? "No gabarito"
												: "Fora do gabarito"
										}
									/>
								</Show>
								<Show when={r.response.kind === "choices"}>
									<Checks checks={(r.response as ChoicesCell).boxes} />
								</Show>
								<div class="min-w-48 flex-1">
									<span class="flex flex-wrap items-center gap-2">
										<Show when={r.response.kind === "chips"}>
											<span class="flex flex-wrap gap-1">
												<For each={(r.response as ChipsCell).chips}>
													{(c) => (
														<span
															class={`badge badge-sm ${c.ok ? "badge-success" : "badge-error"} badge-soft`}
														>
															{c.text}
														</span>
													)}
												</For>
											</span>
										</Show>
										<Show
											when={
												r.response.kind !== "choices" &&
												r.response.kind !== "chips"
											}
										>
											<span class="font-medium">{r.response.text}</span>
										</Show>
										<Show when={r.tag}>
											<span class="badge badge-warning badge-soft badge-sm">
												{r.tag}
											</span>
										</Show>
									</span>
									<Show when={r.sub}>
										<span class="block text-xs text-muted">{r.sub}</span>
									</Show>
									<Bar row={r} max={maxCount()} />
								</div>
							</div>
						),
					},
					{
						title: props.countTitle ?? "Alunos",
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "count",
						sortValue: (r) => r.count,
						render: (r) => (
							<>
								{r.count}
								<span class="block text-xs text-muted">{r.percent}%</span>
							</>
						),
					},
					...(hasScore()
						? [
								{
									title: accepted() ? "Aceita?" : "Nota dada",
									class: "text-right",
									headerClass: "text-right",
									sortKey: "score",
									sortValue: (r: GroupedRow) => r.score ?? null,
									render: (r: GroupedRow) => (
										<>
											<Show
												when={accepted()}
												fallback={
													<span
														class={`tabular-nums ${r.score === 100 ? "text-success" : "text-muted"}`}
													>
														{r.score === null ? "varia" : `${r.score}%`}
													</span>
												}
											>
												{r.score === 100 ? (
													<span class="badge badge-success badge-soft badge-sm">
														sim
													</span>
												) : r.score === 0 ? (
													<span class="badge badge-ghost badge-sm">não</span>
												) : (
													<span class="badge badge-warning badge-soft badge-sm">
														parcial
													</span>
												)}
											</Show>
											<Show when={r.changed > 0}>
												<span class="block text-xs text-info">
													{r.changed}{" "}
													{r.changed === 1 ? "alterada" : "alteradas"}
												</span>
											</Show>
										</>
									),
								},
							]
						: []),
					{
						get title() {
							return (
								<span title="Nota média na prova, nas outras questões, de quem escolheu isto. Só para 3 ou mais alunos. 'revisar' pede conferir o gabarito.">
									Marcação
								</span>
							);
						},
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "mean",
						sortValue: (r) => r.mean,
						render: (r) => (
							<Show
								when={r.mean !== null}
								fallback={<span class="text-muted">–</span>}
							>
								{Math.round(r.mean ?? 0)}%
								<span class="block text-xs">
									<Show
										when={r.diagnosis}
										fallback={<span class="text-muted">esperado</span>}
									>
										<span
											class="font-semibold text-warning"
											title={r.diagnosis}
										>
											revisar
											<span class="sr-only">: {r.diagnosis}</span>
										</span>
									</Show>
								</span>
							</Show>
						),
					},
					{
						get title() {
							return <span class="sr-only">Alunos</span>;
						},
						class: "text-right",
						render: (r) => (
							<PeopleButton
								label={`Ver alunos: ${nameOf(r)}`}
								disabled={r.members.length === 0}
								onClick={() => setOpen(r.id)}
							/>
						),
					},
				]}
			/>
			<Dialog
				id={`grupo-${id}`}
				open={group() !== undefined}
				onClose={() => setOpen(null)}
				title={
					<Show when={group()}>
						{(g) => (
							<>
								{nameOf(g())}
								<span class="ml-2 text-sm font-normal text-muted">
									{g().count} {g().count === 1 ? "aluno" : "alunos"} ·{" "}
									{g().percent}%
									{g().score === undefined
										? ""
										: g().score === null
											? " · nota varia"
											: ` · nota ${g().score}%`}
								</span>
							</>
						)}
					</Show>
				}
			>
				<Show when={group()}>
					{(g) => (
						<Members
							rows={g().members}
							detailTitle={props.detailTitle}
							note={props.note}
						/>
					)}
				</Show>
			</Dialog>
		</>
	);
}
