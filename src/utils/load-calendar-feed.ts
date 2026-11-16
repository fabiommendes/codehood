import type { UserActor } from "@/auth/actor";
import type { Course } from "@/db";
import { db } from "@/db";
import {
	type CalendarEntry,
	calendarEntries,
} from "@/services/calendar-entries";
import { loadCourseExceptions } from "./load-exam-exceptions";
import { addDays, SERVER_TZ, todayIn } from "./schedule-time";

/// How long after a course ends its entries stay in the feed.
export const FEED_COURSE_GRACE_DAYS = 60;

/// What a calendar feed is rendered from: the timeline and the courses it refers to.
export interface CalendarFeedData {
	/// Ordered as `calendarEntries` orders them.
	entries: CalendarEntry[];
	/// Every course an entry may refer to.
	courses: Course[];
}

/**
 * Loads the calendar entries `owner` subscribes to through their feed, as seen by `owner` at `now`.
 *
 * The courses are those `owner` teaches or holds an `ACTIVE` enrollment in,
 * whatever their role (an admin gets no other course), minus those whose
 * `endDate` is more than {@link FEED_COURSE_GRACE_DAYS} days before `now`; a
 * course that ended exactly that long ago stays. Every read runs with `owner`
 * as the actor. Meetings come from one `calendarEvent.findMany` and exams
 * from one `exam.findManyInCourses` restricted to the `SCHEDULED`, `ONGOING`
 * and `COMPLETED` statuses, so drafts never load. With no course left, no
 * event or exam query runs and both lists are empty.
 */
export async function loadCalendarFeed(
	owner: UserActor,
	now: Date,
): Promise<CalendarFeedData> {
	const cutoff = addDays(todayIn(SERVER_TZ, now), -FEED_COURSE_GRACE_DAYS);
	const member = await db.course.findMany(
		{ member: owner.username },
		{ actor: owner },
	);
	const courses = member.filter((course) => course.endDate >= cutoff);
	if (courses.length === 0) return { entries: [], courses: [] };

	const courseIds = courses.map((course) => course.id);
	const [events, exams, exceptions] = await Promise.all([
		db.calendarEvent.findMany({ courseIds }, { actor: owner }),
		db.exam.findManyInCourses(
			{ courseIds, statuses: ["SCHEDULED", "ONGOING", "COMPLETED"] },
			{ actor: owner },
		),
		Promise.all(
			courseIds.map(
				async (id) => [id, await loadCourseExceptions(id)] as const,
			),
		).then((entries) => new Map(entries)),
	]);
	const courseExams = exams.map((entry) => ({
		...entry,
		exception:
			exceptions
				.get(entry.courseId)
				?.get(entry.exam.slug)
				?.get(owner.username) ?? null,
	}));
	return { entries: calendarEntries(events, courseExams), courses };
}
