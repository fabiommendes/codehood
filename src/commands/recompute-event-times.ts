import { Command } from "commander";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

export const recomputeEventTimesCommand = new Command("recompute-event-times")
	.description(
		"Recompute every calendar event's start and duration from its course, slot and week",
	)
	.action(async () => {
		const changed = await db.calendarEvent.recomputeTimes(FULL_ACCESS);
		console.log(`Recomputed ${changed} event(s).`);
	});
