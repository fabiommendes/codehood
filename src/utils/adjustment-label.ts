import { locale, m } from "@/i18n";
import type { AdjustmentOp } from "@/services/exam-result";

/// A number in the locale's decimal separator, without trailing zeros.
function plain(value: number, digits: number): string {
	return value.toLocaleString(locale, { maximumFractionDigits: digits });
}

/** The text of one adjustment for the student and the instructor, e.g. "Bônus +10", "Penalidade ×0,5", "Nota substituída por 80%", "Zerada". */
export function adjustmentLabel(adjustment: {
	op: AdjustmentOp;
	value: number;
}): string {
	const { op, value } = adjustment;
	if (op === "SET") {
		return m.grades_adjustment_set({ percent: plain(value * 100, 1) });
	}
	if (op === "OFFSET") {
		const points = plain(Math.abs(value) * 100, 1);
		return value < 0
			? m.grades_adjustment_penalty_offset({ points })
			: m.grades_adjustment_bonus_offset({ points });
	}
	if (value === 0) return m.grades_adjustment_zeroed();
	const factor = plain(value, 2);
	return value < 1
		? m.grades_adjustment_penalty_factor({ factor })
		: m.grades_adjustment_bonus_factor({ factor });
}
