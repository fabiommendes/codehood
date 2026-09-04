/**
 * The one implementation of the exam <-> calendar-event match, imported by
 * both `TimeSlotService`/`EventService` and (once it exists) `ExamService`.
 * See "The exam link is derived from the clock, never authored" in
 * `dev/specs/to-review/calendar.md`.
 *
 * A standalone module rather than a method on either service, because
 * `exam.service.ts` and `event.service.ts` would otherwise import each other.
 */
import { endOf } from "@/utils/schedule-time";
import type { PrismaTx } from "./client";

/** The minimal event shape the match needs. */
export interface EventWindow {
	courseId: number;
	startAt: Date;
	durationMin: number;
}

/** The minimal exam shape the match needs. */
interface ExamWindow {
	id: number;
	courseId: number;
	scheduledAt: Date | null;
	durationMs: number | null;
	extraTimeMs: number;
}

/**
 * Whether `exam` and `event` overlap: same course, and their half-open
 * intervals intersect. Adjacency is not overlap — an exam starting exactly
 * when a class ends does not match it. A null `durationMs` is treated as a
 * one-millisecond interval; a null `scheduledAt` matches nothing.
 */
function overlaps(exam: ExamWindow, event: EventWindow): boolean {
	if (exam.courseId !== event.courseId) return false;
	if (!exam.scheduledAt) return false;
	const eventEnd = endOf(event.startAt, event.durationMin);
	const examStart = exam.scheduledAt;
	const examEnd = new Date(
		+examStart + (exam.durationMs ?? 1) + exam.extraTimeMs,
	);
	return examStart < eventEnd && examEnd > event.startAt;
}

/**
 * The exam `event` overlaps, applying the tie-break: several exams inside one
 * event resolve to the earliest `scheduledAt`, then the lowest `id`. Returns
 * `null` when nothing overlaps.
 */
export async function examForEvent(
	tx: PrismaTx,
	event: EventWindow,
): Promise<number | null> {
	const eventEnd = endOf(event.startAt, event.durationMin);
	const candidates = await tx.exam.findMany({
		where: {
			courseId: event.courseId,
			scheduledAt: { not: null, lt: eventEnd },
		},
		select: {
			id: true,
			courseId: true,
			scheduledAt: true,
			durationMs: true,
			extraTimeMs: true,
		},
	});

	let best: (ExamWindow & { scheduledAt: Date }) | null = null;
	for (const exam of candidates) {
		if (!exam.scheduledAt) continue;
		if (!overlaps(exam, event)) continue;
		const candidate = { ...exam, scheduledAt: exam.scheduledAt };
		if (
			!best ||
			candidate.scheduledAt < best.scheduledAt ||
			(candidate.scheduledAt.getTime() === best.scheduledAt.getTime() &&
				candidate.id < best.id)
		) {
			best = candidate;
		}
	}
	return best?.id ?? null;
}

/**
 * Recomputes `examId` on every event `examId` could have touched: those
 * currently pointing at it, plus those whose window overlaps its current one.
 * Does not push the exam onto its events directly — it evaluates
 * {@link examForEvent} on each candidate, so an exam moving off a row that
 * another exam also overlaps hands that row to the second exam rather than
 * blanking it. A no-op if the exam does not exist (e.g. it was deleted in the
 * same transaction).
 */
export async function relinkExam(tx: PrismaTx, examId: number): Promise<void> {
	const exam = await tx.exam.findUnique({
		where: { id: examId },
		select: {
			id: true,
			courseId: true,
			scheduledAt: true,
			durationMs: true,
			extraTimeMs: true,
		},
	});
	if (!exam) return;

	const eventSelect = {
		id: true,
		courseId: true,
		startAt: true,
		durationMin: true,
		examId: true,
	} as const;

	const currentlyLinked = await tx.calendarEvent.findMany({
		where: { examId },
		select: eventSelect,
	});

	let windowCandidates: (typeof currentlyLinked)[number][] = [];
	if (exam.scheduledAt) {
		const examStart = exam.scheduledAt;
		const examEnd = new Date(
			+examStart + (exam.durationMs ?? 1) + exam.extraTimeMs,
		);
		const longest = await tx.calendarEvent.aggregate({
			where: { courseId: exam.courseId },
			_max: { durationMin: true },
		});
		const longestMeetingMs = (longest._max.durationMin ?? 0) * 60_000;
		const rangeStart = new Date(+examStart - longestMeetingMs);
		windowCandidates = await tx.calendarEvent.findMany({
			where: {
				courseId: exam.courseId,
				startAt: { gte: rangeStart, lt: examEnd },
			},
			select: eventSelect,
		});
	}

	const candidatesById = new Map<number, (typeof currentlyLinked)[number]>();
	for (const event of currentlyLinked) candidatesById.set(event.id, event);
	for (const event of windowCandidates) candidatesById.set(event.id, event);

	for (const event of candidatesById.values()) {
		const newExamId = await examForEvent(tx, event);
		if (newExamId !== event.examId) {
			await tx.calendarEvent.update({
				where: { id: event.id },
				data: { examId: newExamId },
			});
		}
	}
}
