/// Relative dates for anything scheduled, so the reader never does date arithmetic.

import { locale, m } from "@/i18n";
import { formatDateTime } from "./schedule-time";

const RELATIVE = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

/**
 * `date` as "in 3 days" or "2 hours ago" when it is within a week of `now`, and as a full date otherwise.
 *
 * Callers show {@link formatDateTime} on hover for the exact moment.
 */
export function formatRelative(date: Date, now: Date): string {
	const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
	const size = Math.abs(minutes);
	if (size < 60) return RELATIVE.format(minutes, "minute");
	if (size < 24 * 60) return RELATIVE.format(Math.round(minutes / 60), "hour");
	if (size < 7 * 24 * 60) {
		return RELATIVE.format(Math.round(minutes / (24 * 60)), "day");
	}
	return formatDateTime(date, { year: "numeric" });
}

/** The time until `deadline` as "42 min left", "3 h left" or "2 days left", and seconds in the last minute. */
export function formatTimeLeft(deadline: Date, now: Date): string {
	const seconds = Math.max(
		0,
		Math.ceil((deadline.getTime() - now.getTime()) / 1000),
	);
	if (seconds < 60) return m.time_left_seconds({ count: seconds });
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 180) return m.time_left_minutes({ count: minutes });
	if (minutes < 72 * 60)
		return m.time_left_hours({ count: Math.floor(minutes / 60) });
	return m.time_left_days({ count: Math.floor(minutes / (24 * 60)) });
}
