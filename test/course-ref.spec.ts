/**
 * Every course-scoped service accepts `course` as either the course's
 * numeric id or its natural key `{discipline, instructor, edition}` — see
 * `dev/specs/to-review/course-ref-unification.md`. One course, one row
 * created under each address form, one list read under each address form:
 * both forms must resolve to the same course and agree on what it holds.
 */
import { expect, test } from "@playwright/test";
import type { z } from "zod";
import type { Actor } from "@/auth/actor";
import { FULL_ACCESS } from "@/auth/actor";
import type { CourseId, courseNaturalKey } from "@/core/schemas";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedPassphraseFactory } from "@/fixtures/passphrase.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResourceFactory } from "@/fixtures/resource.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

type CourseNaturalKey = z.infer<typeof courseNaturalKey>;

interface Fixture {
	course: { id: CourseId };
	ref: CourseNaturalKey;
	actor: Actor;
}

// `persistedEditionFactory`'s slug cycles through only 20 combinations,
// which collides once enough courses are provisioned earlier in the same
// (single-worker) run — a fresh, randomly-suffixed edition per fixture
// sidesteps that instead.
let editionTag = 0;
async function ensureEdition(): Promise<string> {
	// `EDITION_RE`: a four-digit year, optionally `-<term>`.
	const slug = `2100-${editionTag++}`;
	await db.edition.create(
		{
			slug,
			name: slug,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-12-31"),
		},
		FULL_ACCESS,
	);
	return slug;
}

/** A fresh course, its natural key, and its owning instructor as an actor. */
async function makeFixture(): Promise<Fixture> {
	const course = await persistedCourseFactory.create({
		edition: await ensureEdition(),
	});
	const ref: CourseNaturalKey = {
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	};
	return {
		course,
		ref,
		actor: {
			username: ref.instructor,
			name: ref.instructor,
			role: "INSTRUCTOR",
		},
	};
}

interface CourseRefCase {
	name: string;
	/**
	 * Creates one row under `course` (either the id or the natural key),
	 * tagged `label` so the two rows created per test are distinguishable.
	 */
	create(
		fx: Fixture,
		course: CourseId | CourseNaturalKey,
		label: string,
	): Promise<unknown>;
	/** Lists every row scoped to `course`, returning something to compare by. */
	list(fx: Fixture, course: CourseId | CourseNaturalKey): Promise<unknown[]>;
	/** Projects a created/listed row to the identity `list()` results carry. */
	idOf(row: unknown): unknown;
}

const cases: CourseRefCase[] = [
	{
		name: "exam",
		async create(fx, course, label) {
			return db.exam.create(
				{ course, slug: `car-exam-${label}`, title: label, type: "EXAM" },
				{ actor: fx.actor },
			);
		},
		list: (fx, course) => db.exam.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
	{
		name: "resource",
		async create(fx, course, label) {
			return db.resource.create(
				{
					course,
					slug: `car-resource-${label}`,
					title: label,
					data: { type: "LINK", url: "https://example.com" },
					rev: `car-ref-${label}`,
				},
				{ actor: fx.actor },
			);
		},
		list: (fx, course) => db.resource.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
	{
		name: "question",
		async create(fx, course, label) {
			return db.question.create(
				{
					course,
					slug: `car-question-${label}`,
					status: "PUBLISHED",
					version: "v1",
					question: {
						type: "essay",
						title: label,
						stem: "Explain.",
					},
				},
				{ actor: fx.actor },
			);
		},
		list: (fx, course) => db.question.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
	{
		name: "time-slot",
		async create(fx, course, label) {
			return db.timeSlot.create(
				{
					course,
					slug: `car-slot-${label}`,
					day: label === "id" ? "MONDAY" : "TUESDAY",
					start: { hour: 8, minute: 0 },
					duration: { hours: 1 },
				},
				{ actor: fx.actor },
			);
		},
		list: (fx, course) => db.timeSlot.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
	{
		name: "passphrase",
		async create(fx, course, label) {
			return db.passphrase.create(
				{ course, value: label === "id" ? "PASSID" : "PASSREF" },
				{ actor: fx.actor },
			);
		},
		list: (fx, course) =>
			db.passphrase.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
	{
		name: "enrollment",
		async create(fx, course, label) {
			const student = await persistedUserFactory.create({ role: "STUDENT" });
			return db.enrollment.create(
				{ course, username: student.username },
				{ actor: fx.actor },
			);
		},
		list: (fx, course) =>
			db.enrollment.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { username: string }).username,
	},
	{
		name: "calendar-event",
		async create(fx, course, label) {
			const slot = await persistedTimeSlotFactory.create(
				{ course, day: label === "id" ? "MONDAY" : "WEDNESDAY" },
				{ transient: { actor: fx.actor } },
			);
			return db.calendarEvent.create(
				{
					course,
					timeSlot: slot.id,
					week: 1,
					title: label,
					rev: `car-cal-${label}`,
				},
				{ actor: fx.actor },
			);
		},
		list: (fx, course) =>
			db.calendarEvent.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
	{
		name: "response",
		async create(fx, course) {
			// SYSTEM provisions the exam and the response's own enrolled author:
			// the point here is the course reference, not the write permission
			// matrix (already covered by response-service.spec.ts), and an
			// instructor `Actor` built by hand for this file isn't a real user
			// row `enrollment.create` could point a fresh student at.
			const exam = await persistedExamFactory.create({
				course,
				status: "ONGOING",
				type: "EXAM",
			});
			return persistedResponseFactory.create({ course, exam: exam.slug });
		},
		list: (fx, course) => db.response.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
	{
		name: "submission",
		async create(fx, course) {
			const question = await persistedQuestionFactory.create({ course });
			const exam = await persistedExamFactory.create({
				course,
				status: "ONGOING",
				type: "EXAM",
				questions: [{ slug: question.slug }],
			});
			const response = await persistedResponseFactory.create({
				course,
				exam: exam.slug,
			});
			return persistedSubmissionFactory.create({
				response: { publicId: response.publicId },
				question: question.slug,
			});
		},
		list: (fx, course) =>
			db.submission.findMany({ course }, { actor: fx.actor }),
		idOf: (row) => (row as { id: number }).id,
	},
];

for (const c of cases) {
	test(`${c.name}: course accepts both an id and a natural key, for create and for list`, async () => {
		const fx = await makeFixture();

		const byId = await c.create(fx, fx.course.id, "id");
		const byRef = await c.create(fx, fx.ref, "ref");

		const expected = [c.idOf(byId), c.idOf(byRef)].sort();

		const listedById = await c.list(fx, fx.course.id);
		expect(listedById.map(c.idOf).sort()).toEqual(expected);

		const listedByRef = await c.list(fx, fx.ref);
		expect(listedByRef.map(c.idOf).sort()).toEqual(expected);
	});
}
