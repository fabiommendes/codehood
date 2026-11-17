import type { JSX } from "solid-js";
import { createMemo, createSignal, Show } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import {
	compareNullsLast,
	type SortState,
	toggleSortState,
} from "@/components/ui/table-sort";
import { m } from "@/i18n";
import type { AttemptRow } from "@/services/grading";
import { attemptTotalLabel } from "./attempt-total";
import SanctionDialog from "./SanctionDialog";

/// An attempt's row with, once sanctioned, the total it would have without the sanctions.
export type ResultRow = AttemptRow & { unsanctioned?: number | null };

interface Props {
	/// The exam page's URL.
	href: string;
	/// The course's URL segments and the exam slug, as the sanction action takes them.
	discipline: string;
	course: string;
	exam: string;
	rows: ResultRow[];
	/// The exam's questions, offered as sanction targets.
	questions: readonly { slug: string; title: string }[];
}

type SortField = "name" | "state" | "answered" | "pending" | "total";

const DEFAULT_SORT: SortState<SortField> = { field: "name", direction: "asc" };

/// Right-aligned tabular figures, for both the header and the cells of a numeric column.
const NUMERIC = "text-right tabular-nums";

/// Orders two attempts by `field`, breaking ties by the student's name.
function compareRows(
	a: ResultRow,
	b: ResultRow,
	{ field, direction }: SortState<SortField>,
): number {
	const sign = direction === "asc" ? 1 : -1;
	const byName = a.name.localeCompare(b.name);
	switch (field) {
		case "name":
			return sign * byName;
		case "state":
			return sign * a.state.localeCompare(b.state) || byName;
		case "answered":
			return sign * (a.answered - b.answered) || byName;
		case "pending":
			return sign * (a.pending - b.pending) || byName;
		case "total":
			return (
				compareNullsLast(a.total, b.total, direction, (x, y) => x - y) || byName
			);
	}
}

/**
 * The instructor's view of how an exam went: one row per attempt, sortable by any column, and the way into grading.
 */
export default function ExamResults(props: Props): JSX.Element {
	const [sort, setSort] = createSignal(DEFAULT_SORT);
	const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
	const sorted = createMemo(() =>
		[...props.rows].sort((a, b) => compareRows(a, b, sort())),
	);
	const pending = () => props.rows.reduce((sum, row) => sum + row.pending, 0);

	/// Adds or removes `author` from the selection.
	function toggle(author: string, on: boolean): void {
		const next = new Set(selected());
		if (on) next.add(author);
		else next.delete(author);
		setSelected(next);
	}

	const columns: ColumnConfig<ResultRow>[] = [
		{
			title: m.grades_results_col_student(),
			sortKey: "name",
			render: (row) => (
				<>
					<input
						type="checkbox"
						class="checkbox checkbox-sm mr-3 align-middle"
						aria-label={m.grades_sanction_select_row({ name: row.name })}
						checked={selected().has(row.author)}
						onChange={(event) =>
							toggle(row.author, event.currentTarget.checked)
						}
					/>
					<a href={`${props.href}/attempts/${row.author}`} class="link">
						{row.name}
					</a>
					<Show when={row.dropped}>
						<span class="badge badge-outline badge-sm ml-2">
							{m.grades_results_dropped()}
						</span>
					</Show>
				</>
			),
		},
		{
			title: m.grades_results_col_attempt(),
			sortKey: "state",
			render: (row) =>
				row.state === "submitted"
					? m.grades_results_submitted()
					: m.grades_results_in_progress(),
		},
		{
			title: m.grades_results_col_answered(),
			sortKey: "answered",
			class: NUMERIC,
			headerClass: NUMERIC,
			render: (row) =>
				m.grades_results_answered_of({
					answered: row.answered,
					questions: row.questions,
				}),
		},
		{
			title: m.grades_results_col_to_grade(),
			sortKey: "pending",
			class: NUMERIC,
			headerClass: NUMERIC,
			render: (row) =>
				row.pending > 0 ? m.grades_results_pending({ count: row.pending }) : "",
		},
		{
			title: m.grades_results_col_total(),
			sortKey: "total",
			class: NUMERIC,
			headerClass: NUMERIC,
			render: (row) => (
				<Show
					when={row.unsanctioned !== undefined && row.state === "submitted"}
					fallback={attemptTotalLabel(row.total, row.state)}
				>
					<ins class="font-semibold text-error no-underline">
						{attemptTotalLabel(row.total, row.state)}
					</ins>
					<Show when={row.unsanctioned != null}>
						{" "}
						<del class="text-error">
							{attemptTotalLabel(row.unsanctioned ?? null, row.state)}
						</del>
					</Show>
				</Show>
			),
		},
	];

	return (
		<section class="mt-8">
			<div class="flex items-center justify-between gap-4">
				<h3 class="page-subsubheader">{m.grades_results_students_title()}</h3>
				<div class="flex items-center gap-2">
					<Show when={props.rows.length > 0 && pending() === 0}>
						<a href={`${props.href}/grading`} class="btn btn-outline btn-sm">
							{m.grades_results_review()}
						</a>
					</Show>
					<SanctionDialog
						discipline={props.discipline}
						course={props.course}
						exam={props.exam}
						usernames={[...selected()]}
						questions={props.questions}
						showCount
						triggerLabel={m.grades_sanction_open_selected()}
						disabled={selected().size === 0}
						title={m.grades_sanction_dialog_title()}
						submitLabel={m.grades_sanction_submit()}
					/>
				</div>
			</div>
			<Table
				class="mt-3"
				label={m.grades_results_title()}
				columns={columns}
				data={sorted()}
				empty={m.grades_results_empty()}
				sort={{ key: sort().field, direction: sort().direction }}
				onSort={(key) =>
					setSort((current) => toggleSortState(current, key as SortField))
				}
			/>
		</section>
	);
}
