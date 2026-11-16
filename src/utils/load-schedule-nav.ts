import type { UserActor } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { type CalendarEvent, type Course, db } from "@/db";
import {
	type CalendarEntry,
	calendarEntries,
} from "@/services/calendar-entries";
import {
	type CourseSchedule,
	courseSchedule,
} from "@/services/course-schedule";
import type { CourseNav } from "./course-nav";
import { scheduleNav } from "./course-tabs-nav";
import { loadCourseExceptions } from "./load-exam-exceptions";

/// What the schedule tab draws on: the course's calendar split at `now`.
export interface LoadedSchedule extends CourseSchedule {
	events: CalendarEvent[];
	entries: CalendarEntry[];
	/// The past weeks are folded away: some weeks are already over and others still ahead.
	foldPast: boolean;
}

/**
 * Loads the course's meetings and dated exams, as the actor sees them, grouped by week at `now`.
 *
 * A student's own exceptions move the dates of their exams; an instructor sees the exams as scheduled.
 */
export async function loadSchedule(
	course: Course,
	actor: UserActor,
	now: Date,
): Promise<LoadedSchedule> {
	const canWrite = hasPerm(actor, "course.update-contents", course);
	// The exam service already keeps drafts from students.
	const [events, exams, exceptions] = await Promise.all([
		db.calendarEvent.findMany({ courseIds: [course.id] }, { actor }),
		db.exam.findMany({ course: course.id }, { actor }),
		canWrite ? new Map() : loadCourseExceptions(course.id),
	]);
	const entries = calendarEntries(
		events,
		exams.map((exam) => ({
			courseId: course.id,
			exam,
			exception: exceptions.get(exam.slug)?.get(actor.username) ?? null,
		})),
	);
	const schedule = courseSchedule(entries, course.startDate, now);
	return {
		...schedule,
		events,
		entries,
		// Folding every week away would leave an empty page once the term is over.
		foldPast: schedule.past.length > 0 && schedule.ahead.length > 0,
	};
}

/**
 * Loads the course card of the schedule tab for a page that is not the schedule itself.
 *
 * It lists the same weeks the schedule page does, so the card stays the same across the tab.
 * `context` names the entity of the page, when it has one.
 */
export async function loadScheduleNav(
	course: Course,
	href: string,
	actor: UserActor,
	context?: string,
): Promise<CourseNav> {
	const { past, ahead, foldPast } = await loadSchedule(
		course,
		actor,
		new Date(),
	);
	const nav = scheduleNav(href, { past, ahead }, foldPast);
	return context ? { ...nav, context } : nav;
}
