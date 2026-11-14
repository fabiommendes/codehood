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

interface Props {
	/// The exam page's URL.
	href: string;
	rows: AttemptRow[];
}

type SortField = "name" | "state" | "answered" | "pending" | "total";

const DEFAULT_SORT: SortState<SortField> = { field: "name", direction: "asc" };

/// Right-aligned tabular figures, for both the header and the cells of a numeric column.
const NUMERIC = "text-right tabular-nums";

/// Orders two attempts by `field`, breaking ties by the student's name.
function compareRows(
	a: AttemptRow,
	b: AttemptRow,
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
	const sorted = createMemo(() =>
		[...props.rows].sort((a, b) => compareRows(a, b, sort())),
	);
	const pending = () => props.rows.reduce((sum, row) => sum + row.pending, 0);

	const columns: ColumnConfig<AttemptRow>[] = [
		{
			title: m.grades_results_col_student(),
			sortKey: "name",
			render: (row) => (
				<>
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
			render: (row) => attemptTotalLabel(row.total, row.state),
		},
	];

	return (
		<section class="mt-8">
			<div class="flex items-center justify-between gap-4">
				<h2 class="text-lg font-semibold">{m.grades_results_title()}</h2>
				<Show when={props.rows.length > 0 && pending() === 0}>
					<a href={`${props.href}/grading`} class="btn btn-outline btn-sm">
						{m.grades_results_review()}
					</a>
				</Show>
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
