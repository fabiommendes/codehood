import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type Course,
	type CourseCreate,
	db,
	type User,
	type UserCreate,
} from "@/db";
import { persistedDisciplineFactory } from "./discipline.factory";
import { persistedEditionFactory } from "./edition.factory";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

function buildCourse(params: Partial<CourseCreate>): CourseCreate {
	const startAt = faker.date.soon({ days: 1 });
	const endAt = faker.date.soon({ days: 120, refDate: startAt });

	return {
		discipline: params.discipline ?? "discipline",
		edition: params.edition ?? "edition",
		instructor: params.instructor ?? "instructor",
		description: faker.lorem.sentence(),
		startAt,
		endAt,
	};
}

/** Builds `CourseCreate` payloads, ready for `courseService.create`. */
export const courseFactory = Factory.define<CourseCreate>(({ params }) =>
	buildCourse(params),
);

export interface CoursePersistParams extends PersistParams {
	/**
	 * Students to enroll in the course once it's created: a count (that many
	 * STUDENT users, each with default fields) or a list of per-student
	 * `UserCreate` overrides — one enrolled student per entry.
	 */
	students?: number | Partial<UserCreate>[];
}

function studentOverrides(
	students: CoursePersistParams["students"],
): Partial<UserCreate>[] {
	if (!students) return [];
	if (typeof students === "number") {
		return Array.from({ length: students }, () => ({}));
	}
	return students;
}

/**
 * Builds a `CourseCreate` payload and persists it via `courseService.create`.
 *
 * Any of `discipline`, `edition`, or `instructor` left unset is provisioned
 * automatically (a fresh discipline/edition, and an INSTRUCTOR user) in the
 * same transaction, so `persistedCourseFactory.create()` works with no setup.
 *
 * Pass `{ transient: { students: 5 } }` to also create and enroll that many
 * STUDENT users; the enrolled students are returned alongside the course.
 */
export const persistedCourseFactory = Factory.define<
	CourseCreate,
	CoursePersistParams,
	Course & { students: User[] },
	Partial<CourseCreate>
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);

		const discipline =
			params.discipline ??
			(
				await persistedDisciplineFactory.create(
					{},
					{ transient: transientParams },
				)
			).slug;
		const edition =
			params.edition ??
			(await persistedEditionFactory.create({}, { transient: transientParams }))
				.slug;
		const instructor =
			params.instructor ??
			(
				await persistedUserFactory.create(
					{ role: "INSTRUCTOR" },
					{ transient: transientParams },
				)
			).username;

		const course = await db.course.create(
			{ ...input, discipline, edition, instructor },
			opts,
		);

		const students: User[] = [];
		for (const overrides of studentOverrides(transientParams.students)) {
			const student = await persistedUserFactory.create(
				{ role: "STUDENT", ...overrides },
				{ transient: transientParams },
			);
			await db.enrollment.create(
				{ courseId: course.id, username: student.username },
				opts,
			);
			students.push(student);
		}

		return { ...course, students };
	});

	return buildCourse(params);
});
