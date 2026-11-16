import type { JSX } from "solid-js";
import { createMemo, createSignal, Show } from "solid-js";
import QuestionNumber from "@/components/exam/QuestionNumber";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import {
	compareNullsLast,
	type SortState,
	toggleSortState,
} from "@/components/ui/table-sort";
import { locale, m } from "@/i18n";
import { formatScore } from "@/services/exam-result";
import {
	type DiscriminationGap,
	discriminationFlag,
	type QuestionStats as Stats,
} from "@/services/question-stats";

interface Props {
	/// The exam page's URL.
	href: string;
	/// One entry per exam question, in exam order.
	stats: Stats[];
	/// The display title of each question, by slug; a missing one falls back to the slug.
	titles: Map<string, string>;
	/// The points out of 100 of each question (`pointsByPosition`), in exam order.
	points: string[];
}

/// Right-aligned tabular figures, for both the header and the cells of a numeric column.
const NUMERIC = "text-right tabular-nums";

/// A question's statistics with its 1-based position in the exam.
type Row = Stats & { position: number };

type SortField =
	| "position"
	| "answered"
	| "blank"
	| "average"
	| "correct"
	| "discrimination"
	| "pending";

const DEFAULT_SORT: SortState<SortField> = {
	field: "position",
	direction: "asc",
};

/// Orders two questions by `field`, breaking ties and placing missing values by exam order.
function compareRows(
	a: Row,
	b: Row,
	{ field, direction }: SortState<SortField>,
): number {
	const byPosition = a.position - b.position;
	switch (field) {
		case "position":
			return direction === "asc" ? byPosition : -byPosition;
		case "answered":
		case "blank":
		case "pending":
		case "average":
		case "correct":
		case "discrimination":
			return (
				compareNullsLast(a[field], b[field], direction, (x, y) => x - y) ||
				byPosition
			);
	}
}

/**
 * The instructor's per-question view of an exam: how many answered, how they scored, and what still waits for a grade.
 *
 * Every column sorts; the question column sorts by exam order.
 */
export default function QuestionStats(props: Props): JSX.Element {
	const [sort, setSort] = createSignal(DEFAULT_SORT);
	const sorted = createMemo(() =>
		props.stats
			.map((entry, index): Row => ({ ...entry, position: index + 1 }))
			.sort((a, b) => compareRows(a, b, sort())),
	);
	const gapReasons: Record<DiscriminationGap, string> = {
		"few-attempts": m.grades_stats_gap_few_attempts(),
		"single-question": m.grades_stats_gap_single_question(),
		"no-variance": m.grades_stats_gap_no_variance(),
	};
	const twoDecimals = new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const numeric = (
		title: string,
		sortKey: SortField,
		render: (entry: Row) => JSX.Element,
	): ColumnConfig<Row> => ({
		title,
		sortKey,
		class: NUMERIC,
		headerClass: NUMERIC,
		render,
	});

	const discrimination = (entry: Stats): JSX.Element => {
		if (entry.discrimination === null) {
			const reason = entry.discriminationGap
				? gapReasons[entry.discriminationGap]
				: undefined;
			return (
				<span title={reason}>
					<span aria-hidden="true">—</span>
					<Show when={reason}>
						<span class="sr-only">{reason}</span>
					</Show>
				</span>
			);
		}
		const flag = discriminationFlag(entry.discrimination);
		return (
			<>
				<Show when={flag}>
					<span
						class="badge badge-sm mr-2"
						classList={{
							"badge-error": flag === "error",
							"badge-warning": flag !== "error",
						}}
					>
						{m.grades_stats_review()}
					</span>
				</Show>
				{twoDecimals.format(entry.discrimination)}
			</>
		);
	};

	const columns: ColumnConfig<Row>[] = [
		{
			title: m.grades_stats_col_question(),
			sortKey: "position",
			render: (entry) => (
				<>
					<QuestionNumber
						number={entry.position}
						points={props.points[entry.position - 1]}
					/>{" "}
					<a
						href={`${props.href}/grading/${entry.question}?view=list`}
						class="link"
					>
						{props.titles.get(entry.question) ?? entry.question}
					</a>
				</>
			),
		},
		numeric(
			m.grades_stats_col_answered(),
			"answered",
			(entry) => entry.answered,
		),
		numeric(m.grades_stats_col_blank(), "blank", (entry) => entry.blank),
		numeric(m.grades_stats_col_average(), "average", (entry) =>
			entry.average === null ? "" : formatScore(entry.average),
		),
		numeric(m.grades_stats_col_correct(), "correct", (entry) =>
			entry.correct === null ? "" : formatScore(entry.correct),
		),
		numeric(
			m.grades_stats_col_discrimination(),
			"discrimination",
			discrimination,
		),
		numeric(m.grades_stats_col_to_grade(), "pending", (entry) => (
			<Show when={entry.pending > 0}>
				<a href={`${props.href}/grading/${entry.question}`} class="link">
					{entry.pending}
				</a>
			</Show>
		)),
	];

	return (
		<section class="mt-8">
			<h2 class="text-lg font-semibold">{m.grades_stats_title()}</h2>
			<Show
				when={props.stats.some((entry) => entry.answered > 0)}
				fallback={
					<p class="mt-3 text-sm text-muted">{m.grades_stats_empty()}</p>
				}
			>
				<Table
					class="mt-3"
					label={m.grades_stats_title()}
					columns={columns}
					data={sorted()}
					sort={{ key: sort().field, direction: sort().direction }}
					onSort={(key) =>
						setSort((current) => toggleSortState(current, key as SortField))
					}
				/>
				<p class="mt-2 text-sm text-muted">{m.grades_stats_help()}</p>
			</Show>
		</section>
	);
}
