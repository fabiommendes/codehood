import type { JSX } from "solid-js";
import { createMemo, createSignal, Show } from "solid-js";
import Link from "@/components/Link";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import {
	compareNullsLast,
	type SortState,
	toggleSortState,
} from "@/components/ui/table-sort";
import { m } from "@/i18n";
import type { AttemptRow } from "@/services/grading";
import { type CourseRef, urls } from "@/urls";
import AdjustmentDialog from "./AdjustmentDialog";
import { attemptTotalLabel } from "./attempt-total";
import Icon from "./Icon";

/// An attempt's row with `unadjusted`, its total before every adjustment, question-level ones included.
export type ResultRow = AttemptRow & { unadjusted?: number | null };

interface Props {
	/// The exam's course, whose pages the table links to.
	courseRef: CourseRef;
	/// The course's URL segments and the exam slug, as the adjustment action takes them.
	discipline: string;
	course: string;
	exam: string;
	rows: ResultRow[];
	/// The exam's questions, offered as adjustment targets.
	questions: readonly { slug: string; title: string }[];
}

type SortField = "name" | "state" | "answered" | "pending" | "total";

const DEFAULT_SORT: SortState<SortField> = { field: "name", direction: "asc" };

/// Right-aligned tabular figures, for both the header and the cells of a numeric column.
const NUMERIC = "text-right tabular-nums";

/// The color of an adjusted total: red when the adjustments lowered it, green when they raised it.
function totalTone(row: ResultRow): string {
	if (row.total === null || row.unadjusted == null) return "";
	if (row.total < row.unadjusted) return "text-error";
	return row.total > row.unadjusted ? "text-success" : "";
}

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
	/// The URLs of the exam's pages.
	const links = () => urls.course(props.courseRef).exam(props.exam);
	const [sort, setSort] = createSignal(DEFAULT_SORT);
	const [adjusting, setAdjusting] = createSignal(false);
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
						aria-label={m.grades_adjustment_select_row({ name: row.name })}
						checked={selected().has(row.author)}
						onChange={(event) =>
							toggle(row.author, event.currentTarget.checked)
						}
					/>
					<Link href={links().attempt(row.author)} class="link">
						{row.name}
					</Link>
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
					when={row.unadjusted !== undefined && row.state === "submitted"}
					fallback={attemptTotalLabel(row.total, row.state)}
				>
					<ins class={`font-semibold no-underline ${totalTone(row)}`}>
						{attemptTotalLabel(row.total, row.state)}
					</ins>
					<Show when={row.unadjusted != null}>
						{" "}
						<del class="text-muted">
							{attemptTotalLabel(row.unadjusted ?? null, row.state)}
						</del>
					</Show>{" "}
					<Link
						href={links().adjustments()}
						class="link align-middle text-muted"
						aria-label={m.grades_adjustment_title()}
						title={m.grades_adjustment_title()}
					>
						<Icon name="badgePlus" class="inline size-4" />
					</Link>
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
						<Link href={links().grading()} class="btn btn-outline btn-sm">
							{m.grades_results_review()}
						</Link>
					</Show>
					<button
						type="button"
						class="btn btn-outline btn-sm"
						disabled={selected().size === 0}
						onClick={() => setAdjusting(true)}
					>
						{m.grades_adjustment_open_selected()}
					</button>
					<AdjustmentDialog
						id="adjust-selected"
						open={adjusting()}
						onClose={() => setAdjusting(false)}
						discipline={props.discipline}
						course={props.course}
						exam={props.exam}
						usernames={[...selected()]}
						questions={props.questions}
						showCount
						kind="any"
						title={m.grades_adjustment_dialog_title()}
						submitLabel={m.grades_adjustment_submit()}
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
