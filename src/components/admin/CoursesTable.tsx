import type { JSX } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { Course } from "@/db";
import { locale, m } from "@/i18n";
import { courseHref } from "@/urls";

interface Props {
	courses: Course[];
}

// startAt/endAt are calendar dates with no meaningful time-of-day but stored
// as UTC midnight — format in UTC too, or a negative-offset server timezone
// renders "2026-01-05" as "Jan 4".
function formatTerm(row: Pick<Course, "startAt" | "endAt">): string {
	const short: Intl.DateTimeFormatOptions = {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	};
	const start = row.startAt.toLocaleDateString(locale, short);
	const end = row.endAt.toLocaleDateString(locale, {
		...short,
		year: "numeric",
	});
	return `${start} – ${end}`;
}

export default function CoursesTable(props: Props): JSX.Element {
	const columns: ColumnConfig<Course>[] = [
		{
			title: m.admin_courses_col_discipline(),
			render: (course) => (
				<>
					<div class="font-mono font-medium">{course.discipline.slug}</div>
					<div class="text-xs text-base-content/60">
						{course.discipline.name}
					</div>
				</>
			),
		},
		{
			title: m.admin_courses_col_edition(),
			class: "font-mono text-base-content/60",
			render: (row) => row.edition.slug,
		},
		{
			title: m.admin_courses_col_instructor(),
			render: (row) => row.instructor.name,
		},
		{
			title: m.admin_courses_col_students(),
			class: "text-base-content/60",
			render: (row) => {
				const count = row.enrollmentCount;
				return m.admin_courses_students({ count });
			},
		},
		{
			title: m.admin_courses_col_term(),
			class: "text-base-content/60",
			render: (row) => formatTerm(row),
		},
		{
			title: m.admin_courses_col_actions(),
			class: "text-right",
			headerClass: "text-right",
			render: (row) => (
				<a
					href={courseHref({
						discipline: row.discipline.slug,
						instructor: row.instructor.username,
						edition: row.edition.slug,
					})}
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

	return <Table columns={columns} data={props.courses} class="mt-8" />;
}
