import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { FULL_ACCESS } from "@/auth/actor";
import type { ClockTime } from "@/core/schemas";
import { db, type TimeSlot } from "@/db";
import { toDuration } from "@/utils/schedule-time";

const WEEKDAYS = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
] as const;

// Legacy manifests may still carry the old ten-value kind. Anything that
// is not HOLIDAY or CANCELLED collapses to REGULAR (see EventKind).
const EVENT_KINDS = [
	"LECTURE",
	"LAB",
	"EXAM",
	"REVIEW",
	"SEMINAR",
	"PROJECT",
	"SELF_STUDY",
	"REGULAR",
	"HOLIDAY",
	"RECESS",
	"CANCELLED",
] as const;

/** Maps a manifest's (possibly legacy) kind onto the current `EventKind`. */
function toEventKind(kind: (typeof EVENT_KINDS)[number] | undefined) {
	if (kind === "HOLIDAY" || kind === "CANCELLED") return kind;
	return "REGULAR" as const;
}

const slotEntrySchema = z.object({
	slug: z.string().min(1),
	title: z.string().optional(),
	day: z.enum(WEEKDAYS),
	start: z.string().regex(/^\d{1,2}:\d{2}$/),
	duration: z.number().int().positive(),
});

// `date`/`start`/`duration` are accepted so an older manifest still parses,
// but they are no longer authored: an event's time is derived from its
// course, week, and slot. `slug` is kept only for console output — identity
// is now `(course, week, slot)`.
const eventEntrySchema = z.object({
	slug: z.string().min(1),
	slot: z.string().min(1),
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	start: z
		.string()
		.regex(/^\d{1,2}:\d{2}$/)
		.optional(),
	duration: z.number().int().positive().optional(),
	week: z.number().int(),
	kind: z.enum(EVENT_KINDS).optional(),
	title: z.string().min(1),
	description: z.string().optional(),
});

const manifestSchema = z.object({
	slots: z.array(slotEntrySchema).default([]),
	events: z.array(eventEntrySchema).default([]),
});

type SlotEntry = z.infer<typeof slotEntrySchema>;
type EventEntry = z.infer<typeof eventEntrySchema>;

/** `"14:00"` -> `{ hour: 14, minute: 0 }`. */
function parseClock(clock: string): ClockTime {
	const [hourRaw, minuteRaw] = clock.split(":");
	const hour = Number(hourRaw);
	const minute = Number(minuteRaw);
	return { hour, minute };
}

function canonicalHash(entry: unknown): string {
	return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

export const importCalendarCommand = new Command("import-calendar")
	.description(
		"Import a course's time slots and events from a YAML manifest, shaped like the sync payload",
	)
	.argument("<discipline-slug>", "discipline slug, e.g. cs101")
	.argument("<instructor>", "the instructor's username")
	.argument("<edition>", "e.g. 2026 or 2026-1")
	.argument("<manifest>", "path to the calendar YAML file")
	.option(
		"--prune",
		"delete events not named in the manifest (default: additive); never deletes slots",
	)
	.action(
		async (
			disciplineSlug: string,
			instructor: string,
			edition: string,
			manifestPath: string,
			options: { prune?: boolean },
		) => {
			const course = await db.course.findOne(
				{
					discipline: disciplineSlug,
					instructor: instructor,
					edition,
				},
				FULL_ACCESS,
			);
			if (!course) {
				console.error(`No course ${disciplineSlug}/${instructor}_${edition}.`);
				process.exitCode = 1;
				return;
			}

			let manifest: { slots: SlotEntry[]; events: EventEntry[] };
			try {
				const raw = await readFile(manifestPath, "utf8");
				manifest = manifestSchema.parse(parseYaml(raw));
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exitCode = 1;
				return;
			}

			const slotsBySlug = new Map<string, TimeSlot>();
			for (const entry of manifest.slots) {
				try {
					const existing = await db.timeSlot.findOne(
						{ course: course.id, slug: entry.slug },
						FULL_ACCESS,
					);
					let slot: TimeSlot;
					if (existing) {
						slot = await db.timeSlot.update(
							{ id: existing.id },
							{
								title: entry.title,
								day: entry.day,
								start: parseClock(entry.start),
								duration: toDuration(entry.duration),
							},
							FULL_ACCESS,
						);
						console.log(`Updated  slot ${entry.slug} (${entry.day}).`);
					} else {
						slot = await db.timeSlot.create(
							{
								course: course.id,
								slug: entry.slug,
								title: entry.title,
								day: entry.day,
								start: parseClock(entry.start),
								duration: toDuration(entry.duration),
							},
							FULL_ACCESS,
						);
						console.log(`Created  slot ${entry.slug} (${entry.day}).`);
					}
					slotsBySlug.set(entry.slug, slot);
				} catch (error) {
					console.error(
						`  ✗ slot ${entry.slug}: ${error instanceof Error ? error.message : error}`,
					);
					process.exitCode = 1;
				}
			}

			// Identity is `(course, week, slot)`, not the manifest's own `slug`.
			const seenEventKeys = new Set<string>();
			for (const entry of manifest.events) {
				const slot = slotsBySlug.get(entry.slot);
				if (!slot) {
					console.error(
						`  ✗ event ${entry.slug}: no slot "${entry.slot}" in this manifest's slots section.`,
					);
					process.exitCode = 1;
					continue;
				}
				seenEventKeys.add(`${entry.week}:${slot.id}`);
				const kind = toEventKind(entry.kind);
				try {
					const existing = await db.calendarEvent.findOne(
						{ course: course.id, week: entry.week, timeSlot: slot.id },
						FULL_ACCESS,
					);
					if (existing) {
						await db.calendarEvent.update(
							{ id: existing.id },
							{
								kind,
								title: entry.title,
								description: entry.description ?? null,
								ref: canonicalHash(entry),
							},
							FULL_ACCESS,
						);
						console.log(
							`Updated  event ${entry.slug} (week ${entry.week}, ${kind}).`,
						);
					} else {
						await db.calendarEvent.create(
							{
								course: course.id,
								timeSlot: slot.id,
								week: entry.week,
								kind,
								title: entry.title,
								description: entry.description ?? null,
								ref: canonicalHash(entry),
							},
							FULL_ACCESS,
						);
						console.log(
							`Created  event ${entry.slug} (week ${entry.week}, ${kind}).`,
						);
					}
				} catch (error) {
					console.error(
						`  ✗ event ${entry.slug}: ${error instanceof Error ? error.message : error}`,
					);
					process.exitCode = 1;
				}
			}

			if (options.prune) {
				const current = await db.calendarEvent.findMany(
					{ courseIds: [course.id] },
					FULL_ACCESS,
				);
				for (const event of current) {
					if (!seenEventKeys.has(`${event.week}:${event.timeSlot.id}`)) {
						await db.calendarEvent.delete({ id: event.id }, FULL_ACCESS);
						console.log(
							`Pruned   event week ${event.week} (${event.timeSlot.slug}, ${event.kind}).`,
						);
					}
				}
			}
		},
	);
