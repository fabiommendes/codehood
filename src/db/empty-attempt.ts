import type { PrismaTx } from "./client";

/**
 * The id of the student's graded attempt at the exam, creating an empty one when there is none.
 *
 * An empty attempt is closed (`acceptingSubmissions: false`, `closedAt: now`), `slotKey: 0`,
 * `preview: false`, has no submissions and carries `createdById`. An existing attempt is reused.
 *
 * @throws {@link InvalidData} keyed on `field`: the exam is `PRACTICE`; the student has no `ACTIVE`
 * enrollment (only checked when creating); the exam's phase for the student, with their exception, is
 * `draft`, `upcoming` or `open`; or `requireFinished` and the existing attempt is not finished.
 */
export async function attemptOrEmpty(
	_tx: PrismaTx,
	_input: {
		examId: number;
		author: string;
		createdBy: string;
		now: Date;
		field: string;
		requireFinished: boolean;
	},
): Promise<{ id: number; publicId: string; created: boolean }> {
	throw new Error("not implemented");
}
