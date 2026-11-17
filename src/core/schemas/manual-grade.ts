import { z } from "zod";
import { slug, username } from "./base";
import { courseRef } from "./course";

/// What grading a question the student left unanswered takes.
export const unansweredGrade = z.object({
	course: courseRef,
	exam: slug,
	author: username,
	question: slug,
	/// A stored score: a decimal string in [0, 1].
	score: z.string(),
	comment: z.string().nullish(),
});
