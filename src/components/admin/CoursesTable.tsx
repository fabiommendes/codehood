import type { JSX } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { Course } from "@/db";
import { courseHref } from "@/utils/course-url";

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
	const start = row.startAt.toLocaleDateString("en-US", short);
	const end = row.endAt.toLocaleDateString("en-US", {
		...short,
		year: "numeric",
	});
	return `${start} – ${end}`;
}

export default function CoursesTable(props: Props): JSX.Element {
	const columns: ColumnConfig<Course>[] = [
		{
			title: "Discipline",
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
			title: "Edition",
			class: "font-mono text-base-content/60",
			render: (row) => row.edition.slug,
		},
		{ title: "Instructor", render: (row) => row.instructor.name },
		{
			title: "Students",
			class: "text-base-content/60",
			render: (row) => {
				const count = row.enrollments.length;
				return `${count} student${count === 1 ? "" : "s"}`;
			},
		},
		{
			title: "Term",
			class: "text-base-content/60",
			render: (row) => formatTerm(row),
		},
		{
			title: "Actions",
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
					aria-label="Open course"
					title="Open course"
				>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none">
						<title>Open course</title>
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
