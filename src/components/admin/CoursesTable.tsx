import type { JSX } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";

/**
 * One row's worth of pre-computed display data — free of `CourseWithDetails`
 * and `courseService` on purpose, same split as `EditionsTable`/`UsersTable`:
 * this component only renders rows, the `.astro` page owns fetching them and
 * building each course's URL.
 */
export interface CourseRow {
	id: number;
	disciplineSlug: string;
	disciplineName: string;
	editionSlug: string;
	instructorName: string;
	activeCount: number;
	startAt: Date;
	endAt: Date;
	href: string;
}

interface Props {
	courses: CourseRow[];
}

// startAt/endAt are calendar dates with no meaningful time-of-day but stored
// as UTC midnight — format in UTC too, or a negative-offset server timezone
// renders "2026-01-05" as "Jan 4".
function formatTerm(row: Pick<CourseRow, "startAt" | "endAt">): string {
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
	const columns: ColumnConfig<CourseRow>[] = [
		{
			title: "Discipline",
			render: (row) => (
				<>
					<div class="font-mono font-medium">{row.disciplineSlug}</div>
					<div class="text-xs text-base-content/60">{row.disciplineName}</div>
				</>
			),
		},
		{
			title: "Edition",
			class: "font-mono text-base-content/60",
			render: (row) => row.editionSlug,
		},
		{ title: "Instructor", render: (row) => row.instructorName },
		{
			title: "Students",
			class: "text-base-content/60",
			render: (row) =>
				`${row.activeCount} student${row.activeCount === 1 ? "" : "s"}`,
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
					href={row.href}
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
