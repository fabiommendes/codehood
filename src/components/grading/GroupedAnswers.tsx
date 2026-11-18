import { createSignal, createUniqueId, For, type JSX, Show } from "solid-js";
import { m } from "@/i18n";
import type { AnswerGroup, ResponseCell } from "@/services/objective-review";
import Dialog, { PeopleButton } from "./Dialog";
import { type GradeTarget, percentOf } from "./grade-actions";
import Members from "./Members";
import SortTable from "./SortTable";

interface Props {
	rows: AnswerGroup[];
	/// Which column the score shows: the score, accepted yes/no/partial, or none.
	column: "score" | "accepted" | "none";
	/// Title of the response column.
	responseHeader: string;
	/// Title of the count column.
	countHeader?: string;
	target: GradeTarget;
	/// Display names by username.
	names: Record<string, string>;
	/// Column title of what each student wrote, in the dialog.
	detailHeader?: string;
}

/// One box of a combination of marked alternatives.
type Check = Extract<ResponseCell, { kind: "choices" }>["boxes"][number];

/// Whether a score is full marks.
const isFull = (score: AnswerGroup["score"]): boolean =>
	typeof score === "number" && score >= 1 - 1e-9;

/// The tone of the share bar: green for what the key accepts.
const barTone = (row: AnswerGroup): string => {
	const cell = row.cell;
	if (cell.kind === "choice")
		return cell.key ? "bg-success" : "bg-base-content/30";
	if (isFull(row.score)) return "bg-success";
	if (typeof row.score !== "number" || row.score === 0)
		return "bg-base-content/30";
	return "bg-warning";
};

/// The text that names a group, in the dialog title and the button label.
const nameOf = (row: AnswerGroup): string => row.cell.text;

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
							label={`${c.letter}${c.on ? `, ${m.grades_objective_marked()}` : ""}${c.key ? `, ${m.grades_objective_in_key()}` : ""}`}
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
function Bar(props: { row: AnswerGroup; max: number }): JSX.Element {
	const r = () => props.row.cell;
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
			{(marked) => {
				const total = () => marked().true + marked().false;
				return (
					<span class="mt-1 block w-full">
						<span class="flex h-1.5 overflow-hidden rounded-full bg-base-200">
							<span
								class="bg-success"
								style={{ width: `${(marked().true / total()) * 100}%` }}
							/>
							<span
								class="bg-error"
								style={{ width: `${(marked().false / total()) * 100}%` }}
							/>
						</span>
						<span class="flex justify-between text-xs tabular-nums text-muted">
							<span>
								{m.grades_summary_true()} {marked().true}
							</span>
							<span>
								{m.grades_summary_false()} {marked().false}
							</span>
						</span>
					</span>
				);
			}}
		</Show>
	);
}

/// The score column of a row: the percentage, "varies", or yes/no/partial for an accepted column.
function ScoreCell(props: {
	row: AnswerGroup;
	column: "score" | "accepted";
}): JSX.Element {
	const score = () => props.row.score;
	return (
		<>
			<Show
				when={score() !== null}
				fallback={<span class="text-muted">–</span>}
			>
				<Show
					when={props.column === "accepted" && typeof score() === "number"}
					fallback={
						<span
							class={`tabular-nums ${isFull(score()) ? "text-success" : "text-muted"}`}
						>
							{typeof score() === "number"
								? `${percentOf(score() as number)}%`
								: m.grades_objective_varies()}
						</span>
					}
				>
					{isFull(score()) ? (
						<span class="badge badge-success badge-soft badge-sm">
							{m.grades_objective_yes()}
						</span>
					) : score() === 0 ? (
						<span class="badge badge-ghost badge-sm">
							{m.grades_objective_no()}
						</span>
					) : (
						<span class="badge badge-warning badge-soft badge-sm">
							{m.grades_objective_partial()}
						</span>
					)}
				</Show>
			</Show>
			<Show when={props.row.changed > 0}>
				<span class="block text-xs text-yellow-700">
					{m.grades_objective_changed_count({ count: props.row.changed })}
				</span>
			</Show>
		</>
	);
}

/**
 * The grouped table of a question: each group with its share bar, count, score and marking, and the people button that opens its students in a dialog.
 */
export default function GroupedAnswers(props: Props): JSX.Element {
	const id = createUniqueId();
	const [open, setOpen] = createSignal<string | null>(null);
	const group = () => props.rows.find((row) => row.id === open());
	const maxCount = () => Math.max(1, ...props.rows.map((row) => row.count));
	const share = (row: AnswerGroup) => Math.round(row.share * 100);
	return (
		<>
			<SortTable
				label={props.responseHeader}
				data={props.rows}
				columns={[
					{
						title: props.responseHeader,
						sortKey: "response",
						sortValue: (row: AnswerGroup) => row.cell.text,
						render: (row: AnswerGroup) => (
							<div class="flex items-center gap-3">
								<Show when={row.cell.kind === "choice"}>
									<ReadOnlyInput
										kind={(row.cell as ChoiceCell).marker}
										checked={(row.cell as ChoiceCell).key}
										tone={(row.cell as ChoiceCell).key ? "success" : "neutral"}
										label={
											(row.cell as ChoiceCell).key
												? m.grades_objective_in_key()
												: m.grades_objective_out_of_key()
										}
									/>
								</Show>
								<Show when={row.cell.kind === "choices"}>
									<Checks checks={(row.cell as ChoicesCell).boxes} />
								</Show>
								<div class="min-w-48 flex-1">
									<span class="flex flex-wrap items-center gap-2">
										<Show when={row.cell.kind === "chips"}>
											<span class="flex flex-wrap gap-1">
												<For each={(row.cell as ChipsCell).chips}>
													{(chip) => (
														<span
															class={`badge badge-sm ${chip.ok ? "badge-success" : "badge-error"} badge-soft`}
														>
															{chip.text}
														</span>
													)}
												</For>
											</span>
										</Show>
										<Show
											when={
												row.cell.kind !== "choices" && row.cell.kind !== "chips"
											}
										>
											<span class="font-medium">{row.cell.text}</span>
										</Show>
									</span>
									<Show when={row.sub}>
										<span class="block text-xs text-muted">{row.sub}</span>
									</Show>
									<Bar row={row} max={maxCount()} />
								</div>
							</div>
						),
					},
					{
						title: props.countHeader ?? m.grades_objective_students(),
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "count",
						sortValue: (row: AnswerGroup) => row.count,
						render: (row: AnswerGroup) => (
							<>
								{row.count}
								<span class="block text-xs text-muted">{share(row)}%</span>
							</>
						),
					},
					...(props.column === "none"
						? []
						: [
								{
									title:
										props.column === "accepted"
											? m.grades_objective_accepted()
											: m.grades_objective_grade_given(),
									class: "text-right",
									headerClass: "text-right",
									sortKey: "score",
									sortValue: (row: AnswerGroup) =>
										typeof row.score === "number" ? row.score : null,
									render: (row: AnswerGroup) => (
										<ScoreCell row={row} column={props.column as "score"} />
									),
								},
							]),
					{
						get title() {
							return (
								<span title={m.grades_objective_marking_hint()}>
									{m.grades_objective_marking()}
								</span>
							);
						},
						class: "text-right tabular-nums",
						headerClass: "text-right",
						sortKey: "mean",
						sortValue: (row: AnswerGroup) => row.mean,
						render: (row: AnswerGroup) => (
							<Show
								when={row.mean !== null}
								fallback={<span class="text-muted">–</span>}
							>
								{percentOf(row.mean ?? 0)}%
								<span class="block text-xs">
									<Show
										when={row.review}
										fallback={
											<span class="text-muted">
												{m.grades_objective_expected()}
											</span>
										}
									>
										<span
											class="font-semibold text-warning"
											title={m.grades_objective_review_hint()}
										>
											{m.grades_objective_review()}
										</span>
									</Show>
								</span>
							</Show>
						),
					},
					{
						get title() {
							return (
								<span class="sr-only">{m.grades_objective_students()}</span>
							);
						},
						class: "text-right",
						render: (row: AnswerGroup) => (
							<PeopleButton
								label={m.grades_objective_view_students({ name: nameOf(row) })}
								disabled={row.members.length === 0}
								onClick={() => setOpen(row.id)}
							/>
						),
					},
				]}
			/>
			<Dialog
				id={`group-${id}`}
				open={group() !== undefined}
				onClose={() => setOpen(null)}
				title={
					<Show when={group()}>
						{(row) => (
							<>
								{nameOf(row())}
								<span class="ml-2 text-sm font-normal text-muted">
									{m.grades_objective_group_summary({
										count: row().count,
										percent: share(row()),
									})}
								</span>
							</>
						)}
					</Show>
				}
			>
				<Show when={group()}>
					{(row) => (
						<Members
							members={row().members}
							target={props.target}
							names={props.names}
							detailHeader={props.detailHeader}
						/>
					)}
				</Show>
			</Dialog>
		</>
	);
}
