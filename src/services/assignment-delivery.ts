import type { AssignmentRestrictions } from "@/core/schemas/assignment";
import type { PushRules } from "./git/hook";

/// What a push needs to be ordered by time.
type TimedPush = { id: number; createdAt: Date };

/// The pushes that count for a team.
export type Delivery<P extends TimedPush> = {
	onTime: P | null;
	late: P | null;
};

/// Whether `a` happened after `b`: later in time, or the larger id on a tie.
function isAfter(a: TimedPush, b: TimedPush): boolean {
	const delta = a.createdAt.getTime() - b.createdAt.getTime();
	return delta > 0 || (delta === 0 && a.id > b.id);
}

/**
 * Picks a team's deliveries: the last push at or before `dueAt` and the last one after it.
 *
 * The order of `pushes` does not matter.
 *
 * @example
 * teamDelivery([], new Date()); // { onTime: null, late: null }
 */
export function teamDelivery<P extends TimedPush>(
	pushes: readonly P[],
	dueAt: Date,
): Delivery<P> {
	const delivery: Delivery<P> = { onTime: null, late: null };
	for (const push of pushes) {
		const key = push.createdAt.getTime() <= dueAt.getTime() ? "onTime" : "late";
		const current = delivery[key];
		if (!current || isAfter(push, current)) delivery[key] = push;
	}
	return delivery;
}

/**
 * Picks the push each checkpoint fixes: the last one at or before its date.
 *
 * The order of `pushes` does not matter; the result follows `checkpoints`.
 *
 * @example
 * checkpointDeliveries([], [{ slug: "parser", at: new Date() }]); // [{ slug: "parser", push: null }]
 */
export function checkpointDeliveries<P extends TimedPush>(
	pushes: readonly P[],
	checkpoints: readonly { slug: string; at: Date }[],
): { slug: string; push: P | null }[] {
	return checkpoints.map(({ slug, at }) => ({
		slug,
		push: teamDelivery(pushes, at).onTime,
	}));
}

/// What `pushRules` reads from an assignment.
export type PushRuleSource = {
	closesAt: Date | null;
	restrictions: AssignmentRestrictions | null;
};

/// The rules of one push, before the messages the caller adds.
export type BasePushRules = Omit<PushRules, "messages">;

/**
 * The rules a push to a team of `assignment` is held to at `now`.
 *
 * A restriction above the limit of the instance gives way to the limit.
 *
 * @example
 * pushRules({ assignment, enrolled: true, now: new Date(), limits }).closed;
 */
export function pushRules(input: {
	assignment: PushRuleSource;
	enrolled: boolean;
	now: Date;
	limits: { maxRepoBytes: number; maxFileBytes: number };
}): BasePushRules {
	const { assignment, enrolled, now, limits } = input;
	const restrictions = assignment.restrictions;
	return {
		closed: assignment.closesAt !== null && now >= assignment.closesAt,
		enrolled,
		maxRepoBytes: Math.min(
			limits.maxRepoBytes,
			restrictions?.maxRepoBytes ?? limits.maxRepoBytes,
		),
		maxFileBytes: Math.min(
			limits.maxFileBytes,
			restrictions?.maxFileBytes ?? limits.maxFileBytes,
		),
		deny: restrictions?.deny ?? [],
	};
}
