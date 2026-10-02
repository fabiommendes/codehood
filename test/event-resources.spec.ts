import { expect, test } from "@playwright/test";
import type { CalendarEventId } from "@/core/schemas";
import type { Resource } from "@/db";
import { splitByEvent } from "@/services/event-resources";

function eventId(n: number): CalendarEventId {
	return n as CalendarEventId;
}

/// A resource with the given title, attached to event `eventN` or general.
function resource(title: string, eventN: number | null): Resource {
	return {
		id: title.length,
		slug: title,
		title,
		description: null,
		data: { type: "LINK", url: "https://example.com" },
		event:
			eventN === null
				? null
				: { id: eventId(eventN), week: eventN, timeSlot: "mon" },
	} as unknown as Resource;
}

function titles(resources: Resource[] | undefined): string[] {
	return (resources ?? []).map((r) => r.title);
}

test("an empty list splits into nothing", () => {
	const { general, byEvent } = splitByEvent([]);
	expect(general).toEqual([]);
	expect(byEvent.size).toBe(0);
});

test("resources without an event are all general, in input order", () => {
	const { general, byEvent } = splitByEvent([
		resource("c", null),
		resource("a", null),
		resource("b", null),
	]);
	expect(titles(general)).toEqual(["c", "a", "b"]);
	expect(byEvent.size).toBe(0);
});

test("resources of one event all land under that event, in input order, and none are general", () => {
	const { general, byEvent } = splitByEvent([
		resource("z", 4),
		resource("a", 4),
	]);
	expect(general).toEqual([]);
	expect([...byEvent.keys()]).toEqual([4]);
	expect(titles(byEvent.get(eventId(4)))).toEqual(["z", "a"]);
});

test("a mixed list splits into general and per-event groups, each in input order", () => {
	const { general, byEvent } = splitByEvent([
		resource("g1", null),
		resource("e2-a", 2),
		resource("e1-a", 1),
		resource("g2", null),
		resource("e2-b", 2),
		resource("e1-b", 1),
	]);
	expect(titles(general)).toEqual(["g1", "g2"]);
	expect(titles(byEvent.get(eventId(1)))).toEqual(["e1-a", "e1-b"]);
	expect(titles(byEvent.get(eventId(2)))).toEqual(["e2-a", "e2-b"]);
});

test("an event with no resources is absent from the map", () => {
	const { byEvent } = splitByEvent([resource("g", null), resource("e", 1)]);
	expect(byEvent.has(eventId(1))).toBe(true);
	expect(byEvent.has(eventId(2))).toBe(false);
	expect(byEvent.get(eventId(2))).toBeUndefined();
});

// A deterministic pseudo-random generator, so the property check is
// reproducible without a clock or Math.random.
function lcg(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
	test(`every resource lands in exactly one place and order is kept (generated input, seed ${seed})`, () => {
		const next = lcg(seed);
		const input = Array.from({ length: 30 }, (_, i) => {
			const pick = Math.floor(next() * 5); // 0 means general
			return resource(`r${i}`, pick === 0 ? null : pick);
		});

		const { general, byEvent } = splitByEvent(input);

		const everywhere = [...general, ...[...byEvent.values()].flat()];
		expect(everywhere).toHaveLength(input.length);
		expect(new Set(everywhere).size).toBe(input.length);

		expect(general.every((r) => r.event === null)).toBe(true);
		expect(titles(general)).toEqual(
			input.filter((r) => r.event === null).map((r) => r.title),
		);
		for (const [id, group] of byEvent) {
			expect(group.length).toBeGreaterThan(0);
			expect(titles(group)).toEqual(
				input.filter((r) => r.event?.id === id).map((r) => r.title),
			);
		}
	});
}
