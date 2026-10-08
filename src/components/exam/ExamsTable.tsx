import {
	createEffect,
	createMemo,
	createSignal,
	For,
	type JSX,
	onMount,
} from "solid-js";
import Badge from "@/components/ui/Badge";
import Table, {
	type ColumnConfig,
	type TableSort,
} from "@/components/ui/Table";
import {
	applySortToParams,
	compareNullsLast,
	type SortState,
	sortStateFromParams,
	toggleSortState,
} from "@/components/ui/table-sort";
import type { Exam } from "@/db";
import {
	type ExamPhase,
	examPhase,
	examPhaseLabels,
} from "@/services/exam-state";
import {
	examPhaseBadgeClass,
	examTypeLabels,
	formatDuration,
} from "@/utils/exam-display";
import { durationToMinutes, formatDateTime } from "@/utils/schedule-time";

/// An exam row as this table renders it — `Exam` minus the raw database id
/// and its pinned questions' own ids, neither of which reach the browser.
/// The table never renders `questions` at all.
type ExamRow = Omit<Exam, "id" | "questions">;

interface Props {
	exams: ExamRow[];
	/** The course's base URL, e.g. `/cs101/ada_2026-1` — exams link to `${href}/exams/${slug}`. */
	href: string;
}

const SORT_FIELDS = [
	"title",
	"type",
	"status",
	"scheduled",
	"duration",
	"tags",
] as const;
type SortField = (typeof SORT_FIELDS)[number];

/// Open exams first, then what is coming, drafts, and what is over; the
/// date breaks ties inside each phase.
const DEFAULT_SORT: SortState<SortField> = {
	field: "status",
	direction: "asc",
};

/// The order `status` sorts by: the exams that need attention first.
const PHASE_RANK: Record<ExamPhase, number> = {
	open: 0,
	upcoming: 1,
	draft: 2,
	closed: 3,
	archived: 4,
};

/// Every cell but the title drops its padding on phones, where a row wraps
/// as a card: the title on its own line, the rest after it.
const CARD_CELL = "max-sm:p-0";

function sortFromUrl(): SortState<SortField> {
	const params = new URLSearchParams(window.location.search);
	return sortStateFromParams(params, SORT_FIELDS, DEFAULT_SORT);
}

/**
 * The course's exam list as a sortable table.
 *
 * Unlike `QuestionsTable`, this has no client-side filtering — a course's
 * exam list is small, and the service already narrows it to whatever `actor`
 * may see, so there is nothing left worth filtering client-side. Sorting is
 * client-side state, though, so this ships a minimal amount of JavaScript
 * (`client:load`, set where it's rendered) just to drive the header clicks.
 */
export default function ExamsTable(props: Props): JSX.Element {
	const [sort, setSort] = createSignal<SortState<SortField>>(DEFAULT_SORT);

	onMount(() => setSort(sortFromUrl()));

	// Keeps the URL in sync without ever navigating — `replaceState` so
	// clicking through columns does not pile up history entries.
	createEffect(() => {
		const params = new URLSearchParams();
		applySortToParams(params, sort(), DEFAULT_SORT);

		const query = params.toString();
		const url = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
		window.history.replaceState(window.history.state, "", url);
	});

	function toggleSort(field: SortField): void {
		setSort((current) => toggleSortState(current, field));
	}

	const sorted = createMemo(() => {
		const rows = [...props.exams];
		const now = new Date();
		const { field, direction } = sort();

		if (field === "tags") {
			return rows.sort((a, b) =>
				compareNullsLast(a.tags[0], b.tags[0], direction, (x, y) =>
					x.localeCompare(y),
				),
			);
		}
		if (field === "scheduled") {
			return rows.sort((a, b) =>
				compareNullsLast(
					a.scheduledAt,
					b.scheduledAt,
					direction,
					(x, y) => x.getTime() - y.getTime(),
				),
			);
		}
		if (field === "duration") {
			return rows.sort((a, b) =>
				compareNullsLast(
					a.duration,
					b.duration,
					direction,
					(x, y) => durationToMinutes(x) - durationToMinutes(y),
				),
			);
		}

		const dirMul = direction === "asc" ? 1 : -1;
		const compare = (a: ExamRow, b: ExamRow): number => {
			switch (field) {
				case "type":
					return examTypeLabels[a.type].localeCompare(examTypeLabels[b.type]);
				case "status":
					return (
						PHASE_RANK[examPhase(a, now)] - PHASE_RANK[examPhase(b, now)] ||
						compareNullsLast(
							a.scheduledAt,
							b.scheduledAt,
							"asc",
							(x, y) => x.getTime() - y.getTime(),
						)
					);
				default:
					return a.title.localeCompare(b.title);
			}
		};
		return rows.sort((a, b) => dirMul * compare(a, b));
	});

	const columns: ColumnConfig<ExamRow>[] = [
		{
			title: "Title",
			class: "font-medium max-sm:basis-full max-sm:p-0",
			sortKey: "title" satisfies SortField,
			render: (exam) => (
				<a href={`${props.href}/exams/${exam.slug}`} class="link link-hover">
					{exam.title}
				</a>
			),
		},
		{
			title: "Type",
			class: `text-base-content/60 ${CARD_CELL}`,
			sortKey: "type" satisfies SortField,
			render: (exam) => examTypeLabels[exam.type],
		},
		{
			title: "Status",
			class: CARD_CELL,
			sortKey: "status" satisfies SortField,
			render: (exam) => {
				const phase = examPhase(exam, new Date());
				return (
					<span class={`badge badge-sm ${examPhaseBadgeClass(phase)}`}>
						{examPhaseLabels[phase]}
					</span>
				);
			},
		},
		{
			title: "Scheduled",
			class: `text-base-content/60 ${CARD_CELL}`,
			sortKey: "scheduled" satisfies SortField,
			render: (exam) =>
				exam.scheduledAt ? formatDateTime(exam.scheduledAt) : "Not scheduled",
		},
		{
			title: "Duration",
			class: `text-base-content/60 ${CARD_CELL}`,
			sortKey: "duration" satisfies SortField,
			render: (exam) => formatDuration(exam.duration),
		},
		{
			title: "Tags",
			class: "max-sm:hidden",
			sortKey: "tags" satisfies SortField,
			render: (exam) => (
				<div class="flex flex-wrap gap-1">
					<For each={exam.tags}>
						{(tag) => (
							<Badge size="xs" style="outline">
								{tag}
							</Badge>
						)}
					</For>
				</div>
			),
		},
	];

	const tableSort = createMemo<TableSort>(() => ({
		key: sort().field,
		direction: sort().direction,
	}));

	return (
		<Table
			class="max-sm:[&_tbody_tr]:flex max-sm:[&_tbody_tr]:flex-wrap max-sm:[&_tbody_tr]:items-center max-sm:[&_tbody_tr]:gap-x-3 max-sm:[&_tbody_tr]:gap-y-1 max-sm:[&_tbody_tr]:px-4 max-sm:[&_tbody_tr]:py-3 max-sm:[&_thead]:sr-only max-sm:[&_td]:border-0 max-sm:[&_tbody_tr:not(:last-child)]:border-b max-sm:[&_tbody_tr]:border-base-300"
			columns={columns}
			data={sorted()}
			sort={tableSort()}
			onSort={(key) => toggleSort(key as SortField)}
		/>
	);
}
