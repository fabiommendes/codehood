import { Factory } from "fishery";
import { db, type Response, type ResponseCreate, type schema } from "@/db";
import { persistedCourseFactory } from "./course.factory";
import { persistedExamFactory } from "./exam.factory";
import { type PersistParams, serviceOpts } from "./support";
import { persistedUserFactory } from "./user.factory";

function buildResponse(
	sequence: number,
	params: Partial<ResponseCreate>,
): ResponseCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		exam: params.exam ?? `exam-${sequence}`,
		author: params.author,
		practiceSession: params.practiceSession,
		acceptingSubmissions: params.acceptingSubmissions,
	};
}

/** Builds `ResponseCreate` payloads, ready for `responseService.create`. */
export const responseFactory = Factory.define<
	ResponseCreate,
	PersistParams,
	ResponseCreate,
	Partial<ResponseCreate>
>(({ sequence, params }) => buildResponse(sequence, params));

/**
 * Builds a `ResponseCreate` payload and persists it via `responseService.create`.
 *
 * `course`, `exam` and `author` are provisioned automatically when left
 * unset: a fresh course, a fresh `ONGOING` `EXAM`-type exam in it (a graded
 * exam, so the resulting attempt's `practiceSession` is `null`), and a fresh
 * student enrolled in the course. Pass `exam` with a `type: "PRACTICE"` exam's
 * slug to open a practice attempt instead.
 */
export const persistedResponseFactory = Factory.define<
	ResponseCreate,
	PersistParams,
	Response,
	Partial<ResponseCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);

		const course =
			params.course ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		const exam =
			params.exam ??
			(
				await persistedExamFactory.create(
					{ course, status: "ONGOING", type: "EXAM" },
					{ transient: transientParams },
				)
			).slug;

		let author = params.author;
		if (!author) {
			const student = await persistedUserFactory.create(
				{ role: "STUDENT" },
				{ transient: transientParams },
			);
			await db.enrollment.create({ course, username: student.username }, opts);
			author = student.username;
		}

		return db.response.create({ ...input, course, exam, author }, opts);
	});

	return buildResponse(sequence, params);
});
