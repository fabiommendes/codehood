/// Where a reader stands on an assignment, for the list and the page badge.
export type ReaderStatus =
	| "no-team"
	| "no-repository"
	| "no-push"
	| "on-time"
	| "late"
	| "no-delivery"
	| "closed";

/**
 * The status of a reader: what to show beside an assignment given their team's
 * deliveries, the team's deadline and when pushes close.
 *
 * Once pushes close the status is `closed` whatever was delivered. A reader
 * with no team (or repository, on an individual assignment) has none of the
 * others.
 *
 * @example
 * readerStatus({ individual: false, closesAt: null, team: null, now: new Date() }); // "no-team"
 */
export function readerStatus(input: {
	individual: boolean;
	closesAt: Date | null;
	team: {
		dueAt: Date;
		delivery: { onTime: object | null; late: object | null };
	} | null;
	now: Date;
}): ReaderStatus {
	const { individual, closesAt, team, now } = input;
	if (!team) return individual ? "no-repository" : "no-team";
	if (closesAt !== null && closesAt <= now) return "closed";
	const { onTime, late } = team.delivery;
	if (team.dueAt <= now) {
		if (late && onTime) return "late";
		return onTime ? "on-time" : "no-delivery";
	}
	return onTime ? "on-time" : "no-push";
}
