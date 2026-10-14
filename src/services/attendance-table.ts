/**
 * Writes a course's attendance report as the rows of a CSV file, header first.
 *
 * Pure: the caller fetches the report, and this only lays it out.
 */

import type { CourseAttendance } from "@/db/services/roll-call.service";

/// One student's cell for one event, as the report stores it.
type AttendanceCell = CourseAttendance["students"][number]["cells"][string];

/// Writes a cell as CSV text: `1` present, `0` absent, `-` otherwise.
function cellText(cell: AttendanceCell | undefined): string {
	if (cell === "present") return "1";
	if (cell === "absent") return "0";
	return "-";
}

/**
 * Writes an attendance report as CSV rows, header first.
 *
 * Each event is a column headed by `${week}/${timeSlot}`. A cell reads `1`
 * when present, `0` when absent, and `-` before enrollment. The status column
 * reads the enrollment status in lower case. The last three columns are the
 * present count, the total and the percentage.
 *
 * @example
 * attendanceCsvRows(report)[0]; // ["username", "name", "schoolId", "status", "1/mon", "present", "total", "%"]
 */
export function attendanceCsvRows(report: CourseAttendance): string[][] {
	const keys = report.events.map((event) => `${event.week}/${event.timeSlot}`);
	return [
		[
			"username",
			"name",
			"schoolId",
			"status",
			...keys,
			"present",
			"total",
			"%",
		],
		...report.students.map((student) => {
			const percent = attendancePercent(student.present, student.total);
			return [
				student.username,
				student.name ?? "",
				student.schoolId ?? "",
				student.status.toLowerCase(),
				...keys.map((key) => cellText(student.cells[key])),
				String(student.present),
				String(student.total),
				percent === null ? "" : percent.toFixed(2),
			];
		}),
	];
}

/**
 * Computes the attendance percentage with two decimals, or `null` when there are no roll calls.
 *
 * @example
 * attendancePercent(1, 3); // 33.33
 * attendancePercent(0, 0); // null
 */
export function attendancePercent(
	present: number,
	total: number,
): number | null {
	if (total === 0) return null;
	return Math.round((present / total) * 10000) / 100;
}
