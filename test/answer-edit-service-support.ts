/**
 * Arrangement shared by the specs of the answer-edit history service
 * (`db.answerEdit`): a course with one exam, one attempt and real batches.
 */
import { expect } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { EXAM_ANSWER_GRACE_MS } from "@/core/constants";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import type {
	AnswerEditAppendResult,
	AnswerEditBatchInput,
	AnswerEditFieldInput,
	AnswerEditFieldResult,
} from "@/db/services/answer-edit.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { encodeEdits, replayEdits } from "@/services/answer-edits/codec";
import {
	AnswerEditMonitor,
	type PendingEditBatch,
} from "@/services/answer-edits/monitor";

export const MINUTE = 60_000;
export const GRACE = EXAM_ANSWER_GRACE_MS;

/// A fixed start for attempts whose clock is injected through `now`.
export const T0 = new Date("2026-03-01T10:00:00.000Z");

/// Random suffix, not a counter: slugs would collide with sibling spec files.
export function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2093-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

export interface WorldOptions {
	type?: "EXAM" | "QUIZ" | "PRACTICE";
	status?: "ONGOING" | "COMPLETED";
	/// Minutes of the exam; the attempt's deadline is its start plus this.
	durationMinutes?: number;
	/// Start the attempt at {@link T0} instead of the real clock.
	startAtT0?: boolean;
	/// More essays in the exam, as `slugs.extra`.
	extraEssays?: number;
}

/**
 * A course with an instructor, an enrolled student with an open attempt, and
 * an exam carrying a text essay, a code essay and a multiple-choice question.
 * The course also owns an `outside` essay the exam does not carry.
 */
export async function makeWorld(options: WorldOptions = {}) {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await enroll(course.id);
	const slugs = {
		text: tag("text-"),
		code: tag("code-"),
		choice: tag("choice-"),
		outside: tag("outside-"),
	};
	await db.question.create(essay(course.id, slugs.text, "text"), FULL_ACCESS);
	await db.question.create(essay(course.id, slugs.code, "code"), FULL_ACCESS);
	await db.question.create(
		essay(course.id, slugs.outside, "text"),
		FULL_ACCESS,
	);
	const extra: string[] = [];
	for (let i = 0; i < (options.extraEssays ?? 0); i++) {
		const slug = tag("extra-");
		extra.push(slug);
		await db.question.create(essay(course.id, slug, "text"), FULL_ACCESS);
	}
	await persistedQuestionFactory.create(
		{ course: course.id, slug: slugs.choice },
		{ transient: { type: "multiple-choice" } },
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		status: "ONGOING",
		type: options.type ?? "EXAM",
		duration: { minutes: options.durationMinutes ?? 60 },
		questions: [
			{ slug: slugs.text },
			{ slug: slugs.code },
			{ slug: slugs.choice },
			...extra.map((slug) => ({ slug })),
		],
	});
	const attempt = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	// Completed only after the attempt exists: a closed exam takes no attempt.
	if (options.status === "COMPLETED") {
		await prisma.exam.update({
			where: { id: exam.id },
			data: { status: "COMPLETED" },
		});
	}
	if (options.startAtT0) {
		await prisma.response.update({
			where: { id: attempt.id },
			data: { createdAt: T0 },
		});
	}
	return {
		instructor,
		course,
		student,
		slugs: { ...slugs, extra },
		exam,
		attempt,
	};
}

export type World = Awaited<ReturnType<typeof makeWorld>>;

function essay(
	course: schema.CourseId,
	slug: string,
	content: "text" | "code",
) {
	return {
		status: "PUBLISHED" as const,
		version: "1",
		course,
		slug,
		question:
			content === "text"
				? {
						type: "essay" as const,
						content: "text" as const,
						stem: "Say something.",
						tags: [],
					}
				: {
						type: "essay" as const,
						content: "code" as const,
						highlight: "javascript",
						stem: "Write code.",
						tags: [],
					},
	};
}

/// An enrolled student of `course`.
export async function enroll(course: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// Another attempt, by another student, at the same exam.
export async function otherAttempt(world: World) {
	const student = await enroll(world.course.id);
	const attempt = await persistedResponseFactory.create({
		course: world.course.id,
		exam: world.exam.slug,
		author: student.username,
	});
	return { student, attempt };
}

export function ref(world: World, now?: Date) {
	return {
		course: world.course.id,
		exam: world.exam.slug,
		attempt: world.attempt.publicId,
		...(now ? { now } : {}),
	};
}

/// Sends `fields` as the student of `world`.
export function send(
	world: World,
	fields: AnswerEditFieldInput[],
	now?: Date,
): Promise<AnswerEditAppendResult> {
	return db.answerEdit.append(
		{ ...ref(world, now), fields },
		{ actor: world.student },
	);
}

/// Sends one batch of the text essay and returns the lone result.
export async function sendBatch(
	world: World,
	batch: AnswerEditBatchInput,
	options: { now?: Date; question?: string } = {},
): Promise<AnswerEditFieldResult> {
	const { results } = await send(
		world,
		[
			{
				question: options.question ?? world.slugs.text,
				field: "answer",
				batch,
			},
		],
		options.now,
	);
	expect(results).toHaveLength(1);
	return results[0] as AnswerEditFieldResult;
}

export function inspect(world: World, now?: Date) {
	return db.answerEdit.inspect(ref(world, now), { actor: world.student });
}

/// Rows of the history of `attempt`, by the question slug.
export async function storedField(
	world: World,
	slug = world.slugs.text,
	field = "answer",
) {
	const question = await prisma.questionRef.findFirst({
		where: { courseId: world.course.id, slug },
	});
	if (!question) return null;
	return prisma.answerEditField.findFirst({
		where: {
			questionId: question.id,
			field,
			history: { responseId: world.attempt.id },
		},
		include: {
			batches: { orderBy: { revision: "asc" } },
			gaps: { orderBy: { id: "asc" } },
			history: true,
		},
	});
}

export function historyOf(world: World) {
	return prisma.answerEditHistory.findUnique({
		where: { responseId: world.attempt.id },
	});
}

/// Every row of the four history tables of the attempt, to compare before and after.
export async function snapshotRows(world: World) {
	const history = await prisma.answerEditHistory.findUnique({
		where: { responseId: world.attempt.id },
		include: {
			fields: { include: { batches: true, gaps: true } },
		},
	});
	return JSON.parse(JSON.stringify(history));
}

//
// Batches
//

export interface Step {
	position: number;
	deleteCount: number;
	insertedText: string;
}

/**
 * A batch built with the real codec: `steps` applied in order to `start`,
 * one millisecond apart, the snapshot taken from `replayEdits`.
 */
export function makeBatch(options: {
	start?: string;
	steps: Step[];
	baseRevision?: number;
	firstSeq?: number;
	batchId?: string;
	sessionId?: string;
	timeOriginMs?: number;
	base?: AnswerEditBatchInput["base"] | "start" | "none";
}): AnswerEditBatchInput {
	const start = options.start ?? "";
	const baseRevision = options.baseRevision ?? 0;
	const firstSeq = options.firstSeq ?? 0;
	const sessionId = options.sessionId ?? "session-1";
	const origin = options.timeOriginMs ?? 0;
	const envelope = encodeEdits(
		options.steps.map((step, i) => ({
			...step,
			startMs: origin + i,
			durationMs: 1,
			kind: "typing" as const,
			timing: null,
		})),
		origin,
	);
	const snapshot = replayEdits(start, envelope);
	let base: AnswerEditBatchInput["base"];
	if (
		options.base === "start" ||
		(options.base === undefined && baseRevision === 0)
	) {
		base = { reason: "start", text: start };
	} else if (typeof options.base === "object") {
		base = options.base;
	}
	return {
		version: 1,
		batchId: options.batchId ?? `${sessionId}:${firstSeq}`,
		sessionId,
		timeOriginMs: origin,
		baseRevision,
		firstSeq,
		edits: envelope.edits,
		snapshot,
		...(base ? { base } : {}),
	};
}

/// The batch that appends `text` to `after`, one edit per code unit.
export function appendBatch(
	after: string,
	text: string,
	extra: Omit<Parameters<typeof makeBatch>[0], "start" | "steps"> = {},
): AnswerEditBatchInput {
	let at = after.length;
	const steps: Step[] = [];
	for (const unit of text) {
		steps.push({ position: at, deleteCount: 0, insertedText: unit });
		at += unit.length;
	}
	return makeBatch({ start: after, steps, ...extra });
}

/// `count` one-character appends after `after`.
export function manyEdits(
	after: string,
	count: number,
	extra: Omit<Parameters<typeof makeBatch>[0], "start" | "steps"> = {},
): AnswerEditBatchInput {
	return appendBatch(after, "x".repeat(count), extra);
}

/// Wraps what a real monitor collected in the shape the service takes.
export function fromMonitor(batch: Readonly<PendingEditBatch>) {
	return JSON.parse(JSON.stringify(batch)) as AnswerEditBatchInput;
}

/// A monitor over `initialText` that types through the same path the page uses.
export function newMonitor(
	initialText: string,
	options: {
		baseRevision?: number;
		firstSeq?: number;
		sessionId?: string;
	} = {},
) {
	return new AnswerEditMonitor({
		initialText,
		sessionId: options.sessionId ?? tag("s-"),
		baseRevision: options.baseRevision ?? 0,
		firstSeq: options.firstSeq ?? 0,
		now: () => 0,
	});
}

/// Types `text` at the end of what the monitor holds.
export function typeInto(monitor: AnswerEditMonitor, text: string, atMs = 10) {
	monitor.recordChange({
		atMs,
		kind: "typing",
		replacements: [
			{
				position: monitor.getState().text.length,
				deleteCount: 0,
				insertedText: text,
			},
		],
	});
}

export function collectBatch(monitor: AnswerEditMonitor): AnswerEditBatchInput {
	const batch = monitor.collect();
	if (batch === null) throw new Error("Expected an edit batch");
	return fromMonitor(batch);
}

/// The size the service measures a batch item by: the JSON of the item.
export function itemBytes(item: AnswerEditFieldInput): number {
	return Buffer.byteLength(JSON.stringify(item));
}

/**
 * A batch item of exactly `target` bytes of JSON, with a start base: the base
 * text is padded (two-byte characters, plus one ASCII for an odd remainder)
 * and deleted by the first edit, then `chunks` whole-text replacements fill
 * the rest.
 */
export function itemOfBytes(
	question: string,
	target: number,
	options: { chunks: number; chunkSize: number; batchId: string },
): AnswerEditFieldInput {
	const build = (padBytes: number): AnswerEditFieldInput => {
		const pad =
			"é".repeat(Math.floor(padBytes / 2)) + (padBytes % 2 ? "a" : "");
		const steps: Step[] = [
			{ position: 0, deleteCount: pad.length, insertedText: "" },
		];
		let current = 0;
		for (let i = 0; i < options.chunks; i++) {
			const chunk = String.fromCharCode(97 + (i % 26)).repeat(
				options.chunkSize,
			);
			steps.push({ position: 0, deleteCount: current, insertedText: chunk });
			current = chunk.length;
		}
		return {
			question,
			field: "answer",
			batch: makeBatch({
				start: pad,
				steps,
				batchId: options.batchId,
				base: { reason: "start", text: pad },
			}),
		};
	};
	let padBytes = 0;
	for (let i = 0; i < 6; i++) {
		const item = build(padBytes);
		const size = itemBytes(item);
		if (size === target) return item;
		padBytes = Math.max(0, padBytes + target - size);
	}
	throw new Error(`Could not build a batch item of ${target} bytes`);
}

/// The receipt of an accepted result.
export function receiptOf(result: AnswerEditFieldResult) {
	if (result.kind !== "accepted" || !result.receipt) {
		throw new Error(
			`Expected an accepted result, got ${JSON.stringify(result)}`,
		);
	}
	return result.receipt;
}
