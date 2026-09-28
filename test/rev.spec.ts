/**
 * Every entity the CLI syncs carries a `rev`: optional on create, nullable
 * when stored, and writable through both `update` and `upsert`.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { calendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { examFactory } from "@/fixtures/exam.factory";
import { questionFactory } from "@/fixtures/question.factory";
import { resourceFactory } from "@/fixtures/resource.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";

type Rev = string | null | undefined;
type WithRev = { id: number; rev: string | null };

interface RevCase {
	name: string;
	/** Creates a row, returning it with the input `upsert` should resend. */
	create(rev: Rev): Promise<{ row: WithRev; input: Record<string, unknown> }>;
	update(row: WithRev, rev: string | null): Promise<WithRev>;
	upsert(input: Record<string, unknown>, rev: string): Promise<WithRev>;
}

function tag(prefix: string): string {
	return `rev-${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/// The input with `rev` left out entirely when `rev` is `undefined`.
function withRev<T extends object>(input: T, rev: Rev): T & { rev?: Rev } {
	const { rev: _rev, ...rest } = input as T & { rev?: Rev };
	return rev === undefined ? (rest as T) : { ...(rest as T), rev };
}

async function courseId() {
	return (await persistedCourseFactory.create()).id;
}

const cases: RevCase[] = [
	{
		name: "course",
		async create(rev) {
			const course = await persistedCourseFactory.create(
				rev === undefined ? {} : { rev },
			);
			const input = {
				discipline: course.discipline.slug,
				instructor: course.instructor.username,
				edition: course.edition.slug,
				startAt: course.startAt,
				endAt: course.endAt,
			};
			return { row: course, input };
		},
		update: (row, rev) =>
			db.course.update({ id: row.id as never }, { rev }, FULL_ACCESS),
		upsert: (input, rev) =>
			db.course.upsert({ ...input, rev } as never, FULL_ACCESS),
	},
	{
		name: "exam",
		async create(rev) {
			const input = withRev(
				examFactory.build({ course: await courseId() }),
				rev,
			);
			return { row: await db.exam.create(input, FULL_ACCESS), input };
		},
		update: (row, rev) =>
			db.exam.update({ id: row.id as never }, { rev }, FULL_ACCESS),
		upsert: (input, rev) =>
			db.exam.upsert({ ...input, rev } as never, FULL_ACCESS),
	},
	{
		name: "question",
		async create(rev) {
			const input = withRev(
				questionFactory.build({ course: await courseId() }),
				rev,
			);
			return { row: await db.question.create(input, FULL_ACCESS), input };
		},
		update: (row, rev) =>
			db.question.update({ id: row.id as never }, { rev }, FULL_ACCESS),
		upsert: (input, rev) =>
			db.question.upsert({ ...input, rev } as never, FULL_ACCESS),
	},
	{
		name: "resource",
		async create(rev) {
			const input = withRev(
				resourceFactory.build({ course: await courseId() }),
				rev,
			);
			return { row: await db.resource.create(input, FULL_ACCESS), input };
		},
		update: (row, rev) =>
			db.resource.update({ id: row.id as never }, { rev }, FULL_ACCESS),
		upsert: (input, rev) =>
			db.resource.upsert({ ...input, rev } as never, FULL_ACCESS),
	},
	{
		name: "calendar-event",
		async create(rev) {
			const slot = await persistedTimeSlotFactory.create({
				slug: tag("slot"),
			});
			const input = withRev(
				calendarEventFactory.build({
					course: slot.courseId,
					timeSlot: slot.id,
				}),
				rev,
			);
			return { row: await db.calendarEvent.create(input, FULL_ACCESS), input };
		},
		update: (row, rev) =>
			db.calendarEvent.update({ id: row.id as never }, { rev }, FULL_ACCESS),
		upsert: (input, rev) =>
			db.calendarEvent.upsert({ ...input, rev } as never, FULL_ACCESS),
	},
];

for (const c of cases) {
	test.describe(`${c.name} rev`, () => {
		test("create leaves rev null when omitted and stores it verbatim when given", async () => {
			expect((await c.create(undefined)).row.rev).toBeNull();

			const rev = tag("given");
			expect((await c.create(rev)).row.rev).toBe(rev);
		});

		test("update replaces rev and null clears it", async () => {
			const { row } = await c.create(tag("first"));

			const next = tag("next");
			expect((await c.update(row, next)).rev).toBe(next);
			expect((await c.update(row, null)).rev).toBeNull();
		});

		test("upsert on an existing row replaces rev", async () => {
			const { input } = await c.create(tag("first"));

			const next = tag("upserted");
			expect((await c.upsert(input, next)).rev).toBe(next);
		});
	});
}
