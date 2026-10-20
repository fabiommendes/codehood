import { m } from "@/i18n";
import { formatScore } from "@/services/exam-result";

/// The total of an attempt as the instructor reads it: a percentage, `Pending`, or a dash while it is open.
export function attemptTotalLabel(
	total: number | null,
	state: "in-progress" | "submitted",
): string {
	if (state === "in-progress") return "—";
	return total === null ? m.grades_table_cell_pending() : formatScore(total);
}
