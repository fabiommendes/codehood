/**
 * When the schedule offers to open a meeting's roll call.
 *
 * Check-in needs the code projected in class, so a roll call only makes sense
 * on the meeting's own day. Opening one is still possible through the API at
 * any time; this rule only decides where the schedule shows the button.
 */
import { localDateOf, SERVER_TZ } from "@/utils/schedule-time";

/**
 * Whether a meeting's roll call may be opened at `now`: from the start of the
 * meeting's local day in `zone` until the meeting ends.
 *
 * @example
 * // A meeting on Friday 14:00-18:00 in São Paulo, seen on Friday at 11:50.
 * rollCallOpenable(
 *   { startAt: new Date("2026-10-16T17:00Z"), endAt: new Date("2026-10-16T21:00Z") },
 *   new Date("2026-10-16T14:50Z"),
 *   "America/Sao_Paulo",
 * ); // true
 */
export function rollCallOpenable(
	meeting: { startAt: Date; endAt: Date },
	now: Date,
	zone: string = SERVER_TZ,
): boolean {
	return (
		localDateOf(meeting.startAt, zone) === localDateOf(now, zone) &&
		now < meeting.endAt
	);
}
