import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { seedUser } from "./helpers";

/// What a student is told about a sanction.
export const REASON = "Copied the answers of a neighbour";

/// What only the instructor reads.
export const NOTES = "Seen by the proctor; same typos as the neighbour";

/**
 * A closed exam of two choice questions that four students answered perfectly.
 *
 * "First question" and "Second question" are the titles on screen; every
 * student sits at 100% until a sanction says otherwise. `prefix` keeps
 * usernames and slugs unique to one story. The grades stay unreleased until
 * `release` runs.
 */
export async function gradedExam(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-prof`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	for (const [slug, title] of [
		["q-first", "First question"],
		["q-second", "Second question"],
	] as const) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: { ...capitalChoice, id: slug, title },
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "honour-exam",
		title: "Honour exam",
		type: "EXAM",
		status: "ONGOING",
		duration: { hours: 1 },
		questions: [{ slug: "q-first" }, { slug: "q-second" }],
	});

	const people = {
		ana: await seedUser({
			role: "STUDENT",
			username: `${prefix}-ana`,
			name: "Ana Prado",
		}),
		bia: await seedUser({
			role: "STUDENT",
			username: `${prefix}-bia`,
			name: "Bia Lima",
		}),
		caio: await seedUser({
			role: "STUDENT",
			username: `${prefix}-caio`,
			name: "Caio Nunes",
		}),
		davi: await seedUser({
			role: "STUDENT",
			username: `${prefix}-davi`,
			name: "Davi Rocha",
		}),
	};
	for (const student of Object.values(people)) {
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		for (const question of ["q-first", "q-second"]) {
			await db.response.submit(
				{
					course: course.id,
					exam: exam.slug,
					question,
					payload: "brasilia",
				},
				{ actor: student },
			);
		}
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});

	/// Releases the grades to the class, as the instructor's button would.
	async function release(): Promise<void> {
		await prisma.exam.update({
			where: { id: exam.id },
			data: { gradesReleasedAt: new Date(Date.now() - 60_000) },
		});
	}

	return {
		teacher,
		course,
		href,
		exam,
		examUrl: `${href}/exams/${exam.slug}`,
		...people,
		release,
	};
}
