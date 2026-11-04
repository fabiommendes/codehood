import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { importCalendarCommand } from "@/commands/import-calendar";
import { db } from "@/db";

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeCourse() {
	const instructor = tag("instructor");
	await db.user.create(
		{
			email: `${instructor}@codehood.test`,
			username: instructor,
			name: instructor,
			role: "INSTRUCTOR",
			password: "correct-horse-battery-staple",
		},
		FULL_ACCESS,
	);
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	if (!(await db.edition.findOne({ slug: "2026-1" }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug: "2026-1",
				name: "2026-1",
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	const course = await db.course.create(
		{
			discipline,
			instructor,
			edition: "2026-1",
			startAt: new Date("2026-03-02T12:00:00Z"),
			endAt: new Date("2026-07-01"),
		},
		FULL_ACCESS,
	);
	return { course, args: [discipline, instructor, "2026-1"] };
}

/// Runs the command on `manifest`, returning what it printed as warnings.
async function importCalendar(args: string[], manifest: string) {
	const dir = await mkdtemp(join(tmpdir(), "import-calendar-"));
	const path = join(dir, "calendar.yaml");
	await writeFile(path, manifest);

	const warnings: string[] = [];
	const warn = console.warn;
	const log = console.log;
	console.warn = (...parts: unknown[]) => warnings.push(parts.join(" "));
	console.log = () => {};
	try {
		await importCalendarCommand.parseAsync([...args, path], { from: "user" });
	} finally {
		console.warn = warn;
		console.log = log;
	}
	return warnings;
}

const MANIFEST = `
slots:
  - { slug: mon, day: MONDAY, start: "14:00", duration: 120 }
events:
  - { slug: intro, slot: mon, week: 0, title: Intro }
  - { slug: break, slot: mon, week: 1, kind: RECESS, title: Break }
  - { slug: old, slot: mon, week: 2, date: "2026-05-01", start: "08:00", duration: 30, title: Old }
`;

test("import-calendar imports a recess as a holiday", async () => {
	const { course, args } = await makeCourse();
	await importCalendar(args, MANIFEST);

	const events = await db.calendarEvent.findMany(
		{ courseIds: [course.id] },
		FULL_ACCESS,
	);
	expect(events.map((e) => [e.week, e.kind])).toEqual([
		[0, "REGULAR"],
		[1, "HOLIDAY"],
		[2, "REGULAR"],
	]);
});

test("import-calendar warns that an event's date, start and duration are ignored", async () => {
	const { course, args } = await makeCourse();
	const warnings = await importCalendar(args, MANIFEST);

	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toContain("old");
	expect(warnings[0]).toContain("ignored");

	const events = await db.calendarEvent.findMany(
		{ courseIds: [course.id], weeks: [2] },
		FULL_ACCESS,
	);
	// The slot's Monday at 14:00 in week 2, not the manifest's date.
	expect(events[0]?.startAt.getTime()).toBe(
		new Date("2026-03-16T17:00:00Z").getTime(),
	);
});
