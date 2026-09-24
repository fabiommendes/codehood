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
	examStatusBadgeClass,
	examTypeLabels,
	formatDuration,
} from "@/utils/exam-display";
import { durationToMinutes, formatDateTime } from "@/utils/schedule-time";

interface Props {
	exams: Exam[];
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

const DEFAULT_SORT: SortState<SortField> = { field: "title", direction: "asc" };

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
		const compare = (a: Exam, b: Exam): number => {
			switch (field) {
				case "type":
					return examTypeLabels[a.type].localeCompare(examTypeLabels[b.type]);
				case "status":
					return a.status.localeCompare(b.status);
				default:
					return a.title.localeCompare(b.title);
			}
		};
		return rows.sort((a, b) => dirMul * compare(a, b));
	});

	const columns: ColumnConfig<Exam>[] = [
		{
			title: "Title",
			class: "font-medium",
			sortKey: "title" satisfies SortField,
			render: (exam) => (
				<a href={`${props.href}/exams/${exam.slug}`} class="link link-hover">
					{exam.title}
				</a>
			),
		},
		{
			title: "Type",
			class: "text-base-content/60",
			sortKey: "type" satisfies SortField,
			render: (exam) => examTypeLabels[exam.type],
		},
		{
			title: "Status",
			sortKey: "status" satisfies SortField,
			render: (exam) => (
				<span class={`badge badge-sm ${examStatusBadgeClass(exam.status)}`}>
					{exam.status}
				</span>
			),
		},
		{
			title: "Scheduled",
			class: "text-base-content/60",
			sortKey: "scheduled" satisfies SortField,
			render: (exam) =>
				exam.scheduledAt ? formatDateTime(exam.scheduledAt) : "Not scheduled",
		},
		{
			title: "Duration",
			class: "text-base-content/60",
			sortKey: "duration" satisfies SortField,
			render: (exam) => formatDuration(exam.duration),
		},
		{
			title: "Tags",
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
			columns={columns}
			data={sorted()}
			sort={tableSort()}
			onSort={(key) => toggleSort(key as SortField)}
		/>
	);
}
