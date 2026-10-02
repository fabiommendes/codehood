import type { CalendarEventId } from "@/core/schemas";
import type { Resource } from "@/db";

/** A course's resources split into the general ones and those of each meeting. */
export interface EventResourceSplit {
	/// Resources that belong to no event, in the input order.
	general: Resource[];
	/// Each event's resources, in the input order. Events with none are absent.
	byEvent: ReadonlyMap<CalendarEventId, Resource[]>;
}

/**
 * Splits resources into general ones and those attached to each event,
 * keeping the input order within each group.
 */
export function splitByEvent(resources: Resource[]): EventResourceSplit {
	const general: Resource[] = [];
	const byEvent = new Map<CalendarEventId, Resource[]>();
	for (const resource of resources) {
		if (!resource.event) {
			general.push(resource);
			continue;
		}
		const list = byEvent.get(resource.event.id as CalendarEventId);
		if (list) list.push(resource);
		else byEvent.set(resource.event.id as CalendarEventId, [resource]);
	}
	return { general, byEvent };
}
