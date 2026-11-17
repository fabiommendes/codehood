import type { CourseId } from "@/core/schemas/base";
import type { Question, QuestionPublic } from "@/db";
import { db } from "@/db";

type Options = Parameters<typeof db.question.findOne>[1];
type PinnedQuestions = {
	questions: readonly { slug: string; version?: string | null }[];
};

/**
 * The questions of an exam, each at the version the exam pins, in exam order and without their database ids.
 *
 * `isPublic: false` brings the answer key and needs an instructor's `options`.
 * A question that no longer resolves is dropped rather than returned blank.
 *
 * @example
 * const questions = await loadExamQuestions(course.id, exam, false, { actor });
 */
export async function loadExamQuestions(
	course: CourseId,
	exam: PinnedQuestions,
	isPublic: false,
	options: Options,
): Promise<Omit<Question, "id">[]>;
export async function loadExamQuestions(
	course: CourseId,
	exam: PinnedQuestions,
	isPublic: true,
	options: Options,
): Promise<Omit<QuestionPublic, "id">[]>;
export async function loadExamQuestions(
	course: CourseId,
	exam: PinnedQuestions,
	isPublic: boolean,
	options: Options,
): Promise<Omit<Question | QuestionPublic, "id">[]> {
	const found = await Promise.all(
		exam.questions.map(({ slug, version }) =>
			isPublic
				? db.question.findOne({ course, slug, version, public: true }, options)
				: db.question.findOne(
						{ course, slug, version, public: false },
						options,
					),
		),
	);
	return found.flatMap((question) => {
		if (!question) return [];
		const { id: _id, ...rest } = question;
		return [rest];
	});
}
