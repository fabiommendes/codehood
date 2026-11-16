import type { AstroGlobal } from "astro";
import type { UserActor } from "@/auth/actor";
import { type Course, db, type Exam, type ExamExceptionView } from "@/db";
import { loadResultPolicy } from "@/db/result-policy";
import { examResult } from "@/services/exam-result";
import {
	releaseBlocker as blockerOf,
	type ExceptionTiming,
	examPhase,
	examSchedule,
	type GradeReleaseBlocker,
	timingFor,
} from "@/services/exam-state";
import {
	type AttemptRow,
	attemptRows,
	type GradedStudent,
} from "@/services/grading";
import { type QuestionStats, questionStats } from "@/services/question-stats";
import { loadCourse } from "./load-course";
import { loadCourseExceptions } from "./load-exam-exceptions";
import { loadStudents } from "./load-grading";

/// What the instructor's pages of one exam share: the numbers behind the course card and the tables.
export interface ExamStaffData {
	/// The course's students, dropped ones included.
	students: GradedStudent[];
	/// The exceptions as stored, with the instructor's notes.
	storedExceptions: ExamExceptionView[];
	/// One row per student who has an attempt or is enrolled.
	resultRows: AttemptRow[];
	/// One row per question of the exam.
	statsRows: QuestionStats[];
	/// What still prevents releasing the grades, or `null` when nothing does.
	releaseBlocker: GradeReleaseBlocker | null;
	/// Answers waiting for a grade.
	pending: number;
	/// Regrade requests still open.
	openRegrades: number;
	/// Exceptions whose personal window has not closed, dropped students aside.
	openExceptions: number;
	/// Attempts still taking answers.
	inProgress: number;
}

/**
 * Loads the tables and counts the instructor's pages of one exam draw on.
 *
 * A practice exam has no attempts to grade nor exceptions, so everything comes back empty.
 */
export async function loadExamStaffData(
	course: Course["id"],
	exam: Exam,
	actor: UserActor,
	exceptions: ReadonlyMap<string, ExceptionTiming>,
	now: Date,
): Promise<ExamStaffData> {
	if (exam.type === "PRACTICE") {
		return {
			students: [],
			storedExceptions: [],
			resultRows: [],
			statsRows: [],
			releaseBlocker: "not-an-exam",
			pending: 0,
			openRegrades: 0,
			openExceptions: 0,
			inProgress: 0,
		};
	}
	await db.response.settleExpired({ course, exam: exam.slug }, { actor });
	const [attempts, feedback, students, storedExceptions, regrades, policyOf] =
		await Promise.all([
			db.response.findMany(
				{ course, exam: exam.slug, practice: false },
				{ actor },
			),
			db.feedback.findMany({ course, exam: exam.slug }, { actor }),
			loadStudents(course, actor),
			db.examException.findMany({ course, exam: exam.slug }, { actor }),
			db.regradeRequest.findMany(
				{ course, exam: exam.slug, status: "OPEN" },
				{ actor },
			),
			loadResultPolicy(course),
		]);
	const slugs = exam.questions.map((question) => question.slug);
	const policy = policyOf(exam);
	const results = attempts.map((entry) =>
		examResult(exam.questions, entry.submissions, feedback, policy),
	);
	const schedule = examSchedule(exam, exceptions);
	const resultRows = attemptRows(
		exam,
		exam.questions,
		attempts,
		feedback,
		students,
		now,
		exceptions,
		policy,
	);
	return {
		students,
		storedExceptions,
		resultRows,
		statsRows: questionStats(
			exam,
			slugs,
			attempts,
			feedback,
			now,
			exceptions,
			policy,
		),
		releaseBlocker: blockerOf(schedule, results, now),
		pending: resultRows.reduce((sum, row) => sum + row.pending, 0),
		openRegrades: regrades.length,
		inProgress: attempts.filter((entry) => entry.acceptingSubmissions).length,
		openExceptions: [...exceptions].filter(([username, exception]) => {
			if (exception.dropped) return false;
			const phase = examPhase(timingFor(schedule, username), now);
			return phase === "upcoming" || phase === "open";
		}).length,
	};
}

export type LoadExamStaffResult =
	| {
			course: Course;
			/// The course's URL prefix.
			href: string;
			exam: Exam;
			/// The exam's exceptions, by username.
			exceptions: Map<string, ExceptionTiming>;
			data: ExamStaffData;
	  }
	| { redirect: Response };

/**
 * Loads an exam page for its instructor, or the response that refuses the visitor.
 *
 * An anonymous visitor goes to `/login` and anyone but the course's instructor
 * gets the 403 page, as in {@link loadCourse}. A missing exam gets the 404
 * page, and so does a practice exam unless `options.practice` is set.
 */
export async function loadExamStaff(
	Astro: AstroGlobal,
	discipline: string | undefined,
	courseSegment: string | undefined,
	slug: string | undefined,
	options: { practice?: boolean } = {},
): Promise<LoadExamStaffResult> {
	const result = await loadCourse(Astro, discipline, courseSegment, {
		manage: true,
	});
	if ("redirect" in result) return result;
	const { course, href } = result;

	// biome-ignore lint/style/noNonNullAssertion: loadCourse already redirected an anonymous visitor.
	const actor = Astro.locals.actor!;
	const exam = slug
		? await db.exam.findOne({ course: course.id, slug }, { actor })
		: null;
	if (!exam || (exam.type === "PRACTICE" && !options.practice)) {
		return { redirect: await Astro.rewrite("/404") };
	}
	const exceptions =
		(await loadCourseExceptions(course.id)).get(exam.slug) ?? new Map();
	const data = await loadExamStaffData(
		course.id,
		exam,
		actor,
		exceptions,
		new Date(),
	);
	return { course, href, exam, exceptions, data };
}
