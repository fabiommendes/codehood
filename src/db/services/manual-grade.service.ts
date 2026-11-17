import type { z } from "zod";
import {
	manualChangeRevert,
	unansweredGrade,
} from "@/core/schemas/manual-grade";
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

	/**
	 * Undoes a change by hand: writes a pass by the actor whose `ref` starts with `REVERT_REF_PREFIX` and whose score is
	 * the automatic one (`autoScoreOf`), or 0 when the answer has no automatic pass (an instructor-created submission).
	 *
	 * Deletes nothing: the history stays and the new pass is the newest, so `isManualChange` turns false.
	 *
	 * @throws {@link NotFound} the submission, or one that belongs to another course or exam.
	 * @throws {@link NotAllowed} actor lacks `course.update-contents` on the course.
	 * @throws {@link InvalidData} keyed on `submission` when the answer is not a change by hand.
	 */
	const revert = op({
		args: [manualChangeRevert],
		returns: submissionSchema,
		run: async (
			_tx: PrismaTx,
			_input: z.input<typeof manualChangeRevert>,
			_opts: ServiceOptsWithoutTx,
		): Promise<Submission> => {
			throw new Error("not implemented");
		},
	});

	return { gradeUnanswered, revert };
});
