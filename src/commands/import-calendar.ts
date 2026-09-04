import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { FULL_ACCESS } from "@/core/actor";
import {
	type CalendarEventCreate,
	calendarEventService,
} from "@/db/services/calendar-event.service";
import { courseService } from "@/db/services/course.service";
import {
	type TimeSlot,
	timeSlotService,
} from "@/db/services/time-slot.service";

const WEEKDAYS = [
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
] as const;

const EVENT_KINDS = [
	"LECTURE",
	"LAB",
	"EXAM",
	"REVIEW",
	"SEMINAR",
	"PROJECT",
	"SELF_STUDY",
	"HOLIDAY",
	"RECESS",
	"CANCELLED",
] as const;

const slotEntrySchema = z.object({
	slug: z.string().min(1),
	title: z.string().optional(),
	day: z.enum(WEEKDAYS),
	start: z.string().regex(/^\d{1,2}:\d{2}$/),
	duration: z.number().int().positive(),
});

const eventEntrySchema = z.object({
	slug: z.string().min(1),
	slot: z.string().min(1),
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

/** `"14:00"` -> `840`. */
function parseClock(clock: string): number {
	const [hourRaw, minuteRaw] = clock.split(":");
	const hour = Number(hourRaw);
	const minute = Number(minuteRaw);
	return hour * 60 + minute;
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
			const course = await courseService.findOne(
				{ ref: { disciplineSlug, username: instructor, edition } },
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
					const existing = await timeSlotService.findOne(
						{ ref: { courseId: course.id, slug: entry.slug } },
						FULL_ACCESS,
					);
					let slot: TimeSlot;
					if (existing) {
						slot = await timeSlotService.update(
							{ id: existing.id },
							{
								title: entry.title,
								day: entry.day,
								startMin: parseClock(entry.start),
								durationMin: entry.duration,
							},
							FULL_ACCESS,
						);
						console.log(`Updated  slot ${entry.slug} (${entry.day}).`);
					} else {
						slot = await timeSlotService.create(
							{
								courseId: course.id,
								slug: entry.slug,
								title: entry.title,
								day: entry.day,
								startMin: parseClock(entry.start),
								durationMin: entry.duration,
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

			const seenEventSlugs = new Set<string>();
			for (const entry of manifest.events) {
				seenEventSlugs.add(entry.slug);
				const slot = slotsBySlug.get(entry.slot);
				if (!slot) {
					console.error(
						`  ✗ event ${entry.slug}: no slot "${entry.slot}" in this manifest's slots section.`,
					);
					process.exitCode = 1;
					continue;
				}
				try {
					const built: Omit<
						CalendarEventCreate,
						"courseId" | "timeSlotId" | "slug"
					> = {
						date: entry.date,
						startMin: entry.start ? parseClock(entry.start) : undefined,
						durationMin: entry.duration,
						week: entry.week,
						kind: entry.kind,
						title: entry.title,
						description: entry.description,
						contentHash: canonicalHash(entry),
					};
					const existing = await calendarEventService.findOne(
						{ ref: { courseId: course.id, slug: entry.slug } },
						FULL_ACCESS,
					);
					if (existing) {
						await calendarEventService.update(
							{ id: existing.id },
							{
								date: built.date,
								startMin: built.startMin,
								durationMin: built.durationMin,
								week: built.week,
								kind: built.kind,
								title: built.title,
								description: built.description,
								contentHash: built.contentHash,
							},
							FULL_ACCESS,
						);
						console.log(
							`Updated  event ${entry.slug} (${entry.kind ?? "LECTURE"}).`,
						);
					} else {
						await calendarEventService.create(
							{
								...built,
								courseId: course.id,
								timeSlotId: slot.id,
								slug: entry.slug,
							},
							FULL_ACCESS,
						);
						console.log(
							`Created  event ${entry.slug} (${entry.kind ?? "LECTURE"}).`,
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
				const current = await calendarEventService.findMany(
					{ courseIds: [course.id] },
					FULL_ACCESS,
				);
				for (const event of current) {
					if (!seenEventSlugs.has(event.slug)) {
						await calendarEventService.delete({ id: event.id }, FULL_ACCESS);
						console.log(`Pruned   event ${event.slug} (${event.kind}).`);
					}
				}
			}
		},
	);
