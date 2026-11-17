import type { z } from "zod";
import { unansweredGrade } from "@/core/schemas/manual-grade";
import { submissionSchema } from "@/core/schemas/submission";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import type { PrismaTx } from "../client";
import type { Submission } from "./submission.service";

/** The service of `client` (the shared client by default). */
export const makeManualGradeService = defineService()(() => {
	/**
	 * Grades a question the student left unanswered: creates, in one transaction, the empty attempt when
	 * needed, an `AUTOSAVE` submission with JSON `null` payload, status `GRADED_MANUALLY` and `createdById`,
	 * and a grading pass by the actor with that score.
	 *
	 * Never checks `assertAcceptingSubmissions`; never creates `SUBMIT` or `FINAL`.
	 *
	 * @throws {@link NotFound} course, exam, or a question the exam does not carry (`question`).
	 * @throws {@link NotAllowed} actor lacks `course.update-contents` on the course.
	 * @throws {@link InvalidData} the `attemptOrEmpty` refusals keyed on `author`, with `requireFinished: true`;
	 * keyed on `question` when the attempt already has a submission to that question (use `grading.grade`);
	 * keyed on `score` when it is not a decimal in [0, 1].
	 */
	const gradeUnanswered = op({
		args: [unansweredGrade],
		returns: submissionSchema,
		run: async (
			_tx: PrismaTx,
			_input: z.input<typeof unansweredGrade>,
			_opts: ServiceOptsWithoutTx,
		): Promise<Submission> => {
			throw new Error("not implemented");
		},
	});

	return { gradeUnanswered };
});
