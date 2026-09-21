import { For, type JSX } from "solid-js";
import Badge from "@/components/ui/Badge";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { Exam } from "@/db";
import {
	examStatusBadgeClass,
	examTypeLabels,
	formatDuration,
} from "@/utils/exam-display";
import { formatDateTime } from "@/utils/schedule-time";

interface Props {
	exams: Exam[];
	/** The course's base URL, e.g. `/cs101/ada_2026-1` — exams link to `${href}/exams/${slug}`. */
	href: string;
}

/**
 * The course's exam list as a plain table.
 *
 * Unlike `QuestionsTable`, this has no client-side filtering — a course's
 * exam list is small, and the service already narrows it to whatever `actor`
 * may see, so there is nothing left worth filtering client-side. Rendered
 * with no `client:*` directive, this ships no JavaScript at all.
 */
export default function ExamsTable(props: Props): JSX.Element {
	const columns: ColumnConfig<Exam>[] = [
		{
			title: "Title",
			class: "font-medium",
			render: (exam) => (
				<a href={`${props.href}/exams/${exam.slug}`} class="link link-hover">
					{exam.title}
				</a>
			),
		},
		{
			title: "Type",
			class: "text-base-content/60",
			render: (exam) => examTypeLabels[exam.type],
		},
		{
			title: "Status",
			render: (exam) => (
				<span class={`badge badge-sm ${examStatusBadgeClass(exam.status)}`}>
					{exam.status}
				</span>
			),
		},
		{
			title: "Scheduled",
			class: "text-base-content/60",
			render: (exam) =>
				exam.scheduledAt ? formatDateTime(exam.scheduledAt) : "Not scheduled",
		},
		{
			title: "Duration",
			class: "text-base-content/60",
			render: (exam) => formatDuration(exam.durationMs),
		},
		{
			title: "Tags",
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

	return (
		<Table
			columns={columns}
			data={[...props.exams].sort((a, b) => a.title.localeCompare(b.title))}
		/>
	);
}
