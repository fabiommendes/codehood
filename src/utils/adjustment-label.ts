import type { AdjustmentOp } from "@/services/exam-result";

/** The text of one adjustment for the student and the instructor, e.g. "Bônus +10", "Penalidade ×0,5", "Nota substituída por 80%", "Zerada". */
export function adjustmentLabel(_adjustment: {
	op: AdjustmentOp;
	value: number;
}): string {
	throw new Error("not implemented");
}
