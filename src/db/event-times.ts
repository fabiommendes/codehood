import { slotInstant } from "@/utils/schedule-time";
import type { Prisma, PrismaClient, PrismaTx } from "./client";

/**
 * Recomputes `startAt` and `durationMin` of the events matching `where` from
 * their course's start, their slot and their week, and returns how many
 * changed.
 *
 * An event's time is always derived from those three; call this whenever one
 * of them changes under existing events.
 */
export async function recomputeEventTimes(
	client: PrismaTx | PrismaClient,
	where: Prisma.CalendarEventWhereInput,
): Promise<number> {
	const events = await client.calendarEvent.findMany({
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
		await client.calendarEvent.update({
			where: { id: event.id },
			data: { startAt, durationMin },
		});
		changed += 1;
	}
	return changed;
}
