import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db, type TimeSlot } from "@/db";
import { calendarEventFactory } from "@/fixtures/calendar-event.factory";
import {
	repositoryTree,
	type TreeFileSpec,
} from "@/fixtures/repository.factory";
import { courseHref } from "@/urls";

/// The instructor as the actor of a push, the way the API acts for them.
export function actingAs(instructor: { username: string; name: string }) {
	return {
		actor: {
			role: "INSTRUCTOR" as const,
			username: instructor.username,
			name: instructor.name,
		},
	};
}

/// Where the course lives in the web app.
export function hrefOf(course: Course): string {
	return courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
}

/// Creates an empty repository, as the first step of a CLI push does.
export async function createRepository(
	course: Course["id"],
	slug: string,
	instructor: { username: string; name: string },
) {
	return db.repository.upsert({ course, slug }, actingAs(instructor));
}

/// Uploads `tree` into the repository and commits it, as the instructor.
export async function pushTree(
	course: Course["id"],
	slug: string,
	instructor: { username: string; name: string },
	tree: Record<string, TreeFileSpec>,
	message: string,
) {
	const opts = actingAs(instructor);
	const pk = { course, slug };
	const repository = await db.repository.upsert(pk, opts);
	const { files, tree: entries } = repositoryTree(tree);
	await db.repository.addFiles({ id: repository.id }, files, opts);
	return db.repository.commit(
		{ id: repository.id },
		{ tree: entries, message },
		opts,
	);
}

/// A meeting of the time slot that cites the repositories `repositories`.
export async function eventCiting(
	course: Course["id"],
	timeSlot: TimeSlot["id"],
	title: string,
	repositories: string[],
) {
	return db.calendarEvent.create(
		{
			...calendarEventFactory.build({ course, timeSlot, week: 1, title }),
			repositories,
		},
		FULL_ACCESS,
	);
}
