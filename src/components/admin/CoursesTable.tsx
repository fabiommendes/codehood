import type { JSX } from "solid-js";
import PaginatedTable from "@/components/ui/PaginatedTable";
import type { CursorPage } from "@/components/ui/Pagination";
import type { ColumnConfig } from "@/components/ui/Table";
import type { Course } from "@/db";
import { m } from "@/i18n";
import { urls } from "@/urls";
import { formatIsoDate } from "@/utils/schedule-time";

interface Props {
	/// One page of the courses.
	courses: Course[];
	/// Links to the pages around this one, and the courses in all.
	cursor: CursorPage;
}

function formatTerm(row: Pick<Course, "startDate" | "endDate">): string {
	const start = formatIsoDate(row.startDate, { year: undefined });
	const end = formatIsoDate(row.endDate);
	return `${start} – ${end}`;
}

export default function CoursesTable(props: Props): JSX.Element {
	const columns: ColumnConfig<Course>[] = [
		{
			title: m.admin_courses_col_discipline(),
			render: (course) => (
				<>
					<div class="font-mono font-medium">{course.discipline.slug}</div>
					<div class="text-xs text-muted">{course.discipline.name}</div>
				</>
			),
		},
		{
			title: m.admin_courses_col_edition(),
			class: "font-mono text-muted",
			render: (row) => row.edition.slug,
		},
		{
			title: m.admin_courses_col_instructor(),
			render: (row) => row.instructor.name,
		},
		{
			title: m.admin_courses_col_students(),
			class: "text-muted",
			render: (row) => {
				const count = row.enrollmentCount;
				return m.admin_courses_students({ count });
			},
		},
		{
			title: m.admin_courses_col_term(),
			class: "text-muted",
			render: (row) => formatTerm(row),
		},
		{
			title: m.admin_courses_col_actions(),
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<a
					href={urls
						.course({
							discipline: row.discipline.slug,
							instructor: row.instructor.username,
							edition: row.edition.slug,
						})
						.index()}
					class="btn btn-square btn-ghost btn-sm"
					aria-label={m.admin_courses_open()}
					title={m.admin_courses_open()}
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
						<title>{m.admin_courses_open()}</title>
						<path
							d="M9 6h9v9M18 6 6 18"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</a>
			),
		},
	];

	return (
		<PaginatedTable
			columns={columns}
			data={props.courses}
			cursor={props.cursor}
			class="mt-8"
		/>
	);
}
