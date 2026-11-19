/**
 * What the assignment pages show about a team's pushes and a reader's status:
 * labels, relative times and the commit messages read from the repository.
 */

import { locale, m } from "@/i18n";
import type { ReaderStatus } from "@/services/assignment-status";
import * as bare from "@/services/git/bare";
import { formatDateTime } from "./schedule-time";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An instant as the pages write it, e.g. "Wed, Nov 18, 14:32". */
export function formatWhen(instant: Date): string {
	return formatDateTime(instant);
}

/**
 * How far `instant` is from `now`, in the largest whole unit: "in 3 days", "2 hours ago".
 *
 * @example
 * formatRelative(new Date(Date.now() + 3 * 86_400_000)); // "in 3 days"
 */
export function formatRelative(instant: Date, now: Date = new Date()): string {
	const diff = instant.getTime() - now.getTime();
	const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const abs = Math.abs(diff);
	if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
	if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
	return rtf.format(Math.round(diff / DAY), "day");
}

/** The seven characters of a commit that the pages show. */
export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

/// A badge's label and colour for each status of a reader.
const STATUS_BADGES: Record<
	ReaderStatus,
	{
		label: () => string;
		variant: "neutral" | "info" | "success" | "warning" | "error";
	}
> = {
	"no-team": { label: m.assignments_status_no_team, variant: "warning" },
	"no-repository": {
		label: m.assignments_status_no_repository,
		variant: "warning",
	},
	"no-push": { label: m.assignments_status_no_push, variant: "neutral" },
	"on-time": { label: m.assignments_status_on_time, variant: "success" },
	late: { label: m.assignments_status_late, variant: "warning" },
	"no-delivery": { label: m.assignments_status_no_delivery, variant: "error" },
	closed: { label: m.assignments_status_closed, variant: "neutral" },
};

/** The badge that tells a reader's status. */
export function statusBadge(status: ReaderStatus): {
	label: string;
	variant: "neutral" | "info" | "success" | "warning" | "error";
} {
	const badge = STATUS_BADGES[status];
	return { label: badge.label(), variant: badge.variant };
}

/** A push as the team panel shows it. */
export interface PushView {
	id: number;
	sha: string;
	/// The first line of the commit message; empty when the repository cannot say.
	message: string;
	/// Full name of whoever pushed; null on a push the server reconciled.
	author: string | null;
	at: Date;
}

/**
 * The pushes of a team ready to show: each with its commit message, read from
 * the repository, and the full name of who pushed.
 *
 * Someone who pushed and later left the team shows by username.
 */
export async function pushViews(
	teamId: number,
	pushes: readonly {
		id: number;
		username: string | null;
		newSha: string;
		createdAt: Date;
	}[],
	members: readonly { username: string; name: string }[],
): Promise<PushView[]> {
	const subjects = await bare.commitSubjects(
		teamId,
		pushes.map((push) => push.newSha),
	);
	const names = new Map(
		members.map((member) => [member.username, member.name]),
	);
	return pushes.map((push) => ({
		id: push.id,
		sha: push.newSha,
		message: subjects.get(push.newSha) ?? "",
		author: push.username ? (names.get(push.username) ?? push.username) : null,
		at: push.createdAt,
	}));
}
