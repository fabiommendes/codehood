import type { JSX } from "solid-js";
import { Show } from "solid-js";
import Table, { type ColumnConfig } from "@/components/ui/Table";
import type { CourseAttendance } from "@/db/services/roll-call.service";
import { m } from "@/i18n";
import { formatAttendancePercent } from "@/utils/course-grades";
import { formatDayMonth } from "@/utils/schedule-time";

interface Props {
	report: CourseAttendance;
}

type Student = CourseAttendance["students"][number];

/// Narrow cells on a phone, where the matrix scrolls sideways.
const CELL = "max-sm:px-2";
/// Right-aligned tabular figures, for both the header and the cells of a numeric column.
const NUMERIC = `${CELL} text-right tabular-nums`;
/// A meeting column: its date and the symbols centered.
const MEETING = `${CELL} text-center`;

type Cell = "present" | "absent" | "before-enrollment";

/// The icon path of each cell, its color, and the word that screen readers and the tooltip give.
const MARKS: Record<
	Cell,
	{ path: string; class: string; label: () => string }
> = {
	present: {
		path: "M5 12.5l4.5 4.5L19 7.5",
		class: "text-success",
		label: m.attendance_table_cell_present,
	},
	absent: {
		path: "M6.5 6.5l11 11m0-11l-11 11",
		class: "text-error",
		label: m.attendance_table_cell_absent,
	},
	"before-enrollment": {
		path: "M7 12h10",
		class: "text-muted",
		label: m.attendance_table_cell_before_enrollment,
	},
};

/// One meeting's cell: an icon labelled with its word, which also shows on hover.
function MeetingCell(props: { cell: Cell }): JSX.Element {
	const cell = MARKS[props.cell];
	return (
		<span class={`inline-flex align-middle ${cell.class}`} title={cell.label()}>
			<svg
				role="img"
				aria-label={cell.label()}
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
			>
				<path
					d={cell.path}
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</span>
	);
}

/**
 * Students against the course's roll calls: present, absent, or `-` before enrollment.
 *
 * The totals come right after the name, so they stay in view however many
 * meetings scroll by. A dropped student is dimmed and labelled.
 */
export default function AttendanceTable(props: Props): JSX.Element {
	const numeric = (
		title: string,
		render: (student: Student) => JSX.Element,
	): ColumnConfig<Student> => ({
		title,
		class: NUMERIC,
		headerClass: NUMERIC,
		render,
	});

	const columns: ColumnConfig<Student>[] = [
		{
			title: m.attendance_table_col_student(),
			class: `${CELL} font-medium`,
			headerClass: CELL,
			render: (student) => (
				<>
					{student.name ?? student.username}
					<Show when={student.status === "DROPPED"}>
						<span class="badge badge-ghost badge-sm ml-1">
							{m.attendance_table_dropped()}
						</span>
					</Show>
				</>
			),
		},
		numeric(m.attendance_table_col_present(), (student) => student.present),
		numeric(m.attendance_table_col_total(), (student) => student.total),
		numeric("%", (student) =>
			formatAttendancePercent(student.present, student.total),
		),
		...props.report.events.map(
			(event): ColumnConfig<Student> => ({
				title: <span title={event.title}>{formatDayMonth(event.startAt)}</span>,
				class: MEETING,
				headerClass: MEETING,
				render: (student) => (
					<MeetingCell
						cell={student.cells[`${event.week}/${event.timeSlot}`] ?? "absent"}
					/>
				),
			}),
		),
	];

	return (
		<Table
			class="mt-6"
			tableClass="min-w-max"
			label={m.attendance_table_label()}
			columns={columns}
			data={props.report.students}
			rowClass={(student) =>
				student.status === "DROPPED" ? "opacity-60" : undefined
			}
			rowHeader
			stickyFirst
		/>
	);
}
