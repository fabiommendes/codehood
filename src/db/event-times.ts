import { slotInstant } from "@/utils/schedule-time";
import type { Prisma, PrismaTx } from "./client";
import { guardedUpdate } from "./conditional-write";

/**
 * Recomputes `startAt` and `durationMin` of the events matching `where` from
 * their course's start, their slot and their week, and returns how many
 * changed.
 *
 * Each event that changes gets a new `updatedAt`, so a version read before
 * the recomputation is stale afterwards.
 *
 * An event's time is always derived from those three; call this whenever one
 * of them changes under existing events.
 */
export async function recomputeEventTimes(
	tx: PrismaTx,
	where: Prisma.CalendarEventWhereInput,
): Promise<number> {
	const events = await tx.calendarEvent.findMany({
		where,
		select: {
			id: true,
			week: true,
			startAt: true,
			durationMin: true,
			timeSlot: { select: { day: true, startMin: true, durationMin: true } },
			course: { select: { startAt: true } },
		},
	});

	let changed = 0;
	for (const event of events) {
		const startAt = slotInstant(
			event.course.startAt,
			event.timeSlot.day,
			event.week,
			event.timeSlot.startMin,
		);
		const durationMin = event.timeSlot.durationMin;
		if (
			startAt.getTime() === event.startAt.getTime() &&
			durationMin === event.durationMin
		) {
			continue;
		}
		await guardedUpdate(
			tx,
			"calendarEvent",
			{ id: event.id },
			{ startAt, durationMin },
			{},
		);
		changed += 1;
	}
	return changed;
}
