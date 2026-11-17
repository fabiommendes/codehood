import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import { generateToken } from "@/auth/token";
import { InvalidData } from "@/core/error";
import type { ExamId, ResponseId } from "@/core/schemas/base";
import { m } from "@/i18n";
import {
	attemptOf,
	examPhase,
	examSchedule,
	isFinished,
	viewerTiming,
} from "@/services/exam-state";
import type { PrismaTx } from "./client";
import { realAttempt } from "./preview-filter";
import {
	examTimingFromDb,
	examTimingSelect,
	freezeQuestionVersions,
	loadExceptionTiming,
} from "./services/exam-questions";
import { valueOrNotFound } from "./utils";

/**
 * The id of the student's graded attempt at the exam, creating an empty one when there is none.
 *
 * An empty attempt is closed (`acceptingSubmissions: false`, `closedAt: now`), `slotKey: 0`,
 * `preview: false`, has no submissions and carries `createdById`. An existing attempt is reused.
 *
 * @throws {@link InvalidData} keyed on `field`: the exam is `PRACTICE`; the student has no `ACTIVE`
 * enrollment (only checked when creating); the exam's phase for the student, with their exception, is
 * `draft`, `upcoming` or `open`; or `requireFinished` and the existing attempt is not finished.
 */
export async function attemptOrEmpty(
	tx: PrismaTx,
	input: {
		examId: ExamId;
		author: string;
		createdBy: string;
		now: Date;
		field: string;
		requireFinished: boolean;
	},
): Promise<{ id: ResponseId; publicId: string; created: boolean }> {
	const refuse = (message: string) =>
		new InvalidData({ [input.field]: [{ code: "invalid", message }] });

	const exam = valueOrNotFound(
		"exam",
		await tx.exam.findUnique({
			where: { id: input.examId },
			select: { courseId: true, ...examTimingSelect },
		}),
	);
	if (exam.type === "PRACTICE") {
		throw refuse(m.errors_empty_attempt_practice());
	}

	const findExisting = () =>
		tx.response.findFirst({
			where: {
				examId: input.examId,
				authorId: input.author,
				slotKey: 0,
				...realAttempt,
			},
			select: {
				id: true,
				publicId: true,
				createdAt: true,
				acceptingSubmissions: true,
			},
		});
	const reuse = (row: { id: ResponseId; publicId: string }) => ({
		id: row.id,
		publicId: row.publicId,
		created: false,
	});

	const existing = await findExisting();
	if (existing && !input.requireFinished) return reuse(existing);

	const timing = examTimingFromDb(exam);
	const exception = await loadExceptionTiming(tx, input.examId, input.author);
	const personal = viewerTiming(timing, exception);
	const phase = examPhase(personal, input.now);

	if (existing) {
		// An archived exam is closed for the student, whatever the state of the attempt.
		const schedule = examSchedule(
			timing,
			exception ? new Map([[input.author, exception]]) : new Map(),
		);
		const finished =
			phase === "archived" ||
			isFinished(attemptOf(schedule, input.author, existing, input.now));
		if (!finished) {
			throw refuse(
				m.errors_empty_attempt_in_progress({ username: input.author }),
			);
		}
		return reuse(existing);
	}

	const enrollment = await tx.enrollment.findFirst({
		where: {
			courseId: exam.courseId,
			username: input.author,
			status: "ACTIVE",
		},
		select: { id: true },
	});
	if (!enrollment) {
		throw refuse(
			m.errors_empty_attempt_not_enrolled({ username: input.author }),
		);
	}
	if (phase === "draft" || phase === "upcoming" || phase === "open") {
		throw refuse(m.errors_empty_attempt_exam_open({ username: input.author }));
	}

	try {
		const created = await tx.response.create({
			data: {
				publicId: generateToken(9),
				authorId: input.author,
				examId: input.examId,
				slotKey: 0,
				preview: false,
				acceptingSubmissions: false,
				closedAt: input.now,
				createdById: input.createdBy,
			},
			select: { id: true, publicId: true },
		});
		await freezeQuestionVersions(tx, input.examId);
		return { ...created, created: true };
	} catch (error) {
		// A concurrent create won the unique `(author, exam, slotKey)`: use its attempt.
		if (!(error instanceof PrismaClientKnownRequestError)) throw error;
		if (error.code !== "P2002") throw error;
		const winner = await findExisting();
		if (!winner) throw error;
		return reuse(winner);
	}
}
