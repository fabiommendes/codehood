// Presentation helpers for calendar events (Schedule tab, course home).

import type { z } from "zod";
import type { eventKindSchema } from "@/core/schemas/calendar-event";

type EventKind = z.infer<typeof eventKindSchema>;

const LABELS: Record<EventKind, string | null> = {
	REGULAR: null,
	HOLIDAY: "Holiday",
	CANCELLED: "Cancelled",
};

/**
 * Sentence-case label for an event kind, or `null` for a regular event, which
 * needs no badge.
 */
export function eventKindLabel(kind: EventKind): string | null {
	return LABELS[kind];
}
