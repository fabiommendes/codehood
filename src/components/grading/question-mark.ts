import { m } from "@/i18n";
import type { QuestionMark } from "@/services/grading";

/// The classes of each state of a question on the attempt page: its button in the bar, its dot in the legend and the color of its number.
export const MARK_STYLE: Record<
	QuestionMark,
	{ chip: string; dot: string; tone: string }
> = {
	correct: { chip: "btn-success", dot: "bg-success", tone: "text-success" },
	partial: { chip: "btn-warning", dot: "bg-warning", tone: "text-warning" },
	wrong: { chip: "btn-error", dot: "bg-error", tone: "text-error" },
	blank: {
		chip: "btn-outline border-base-content/20 text-base-content/50",
		dot: "border border-base-content/30",
		tone: "text-base-content/50",
	},
	changed: {
		chip: "border-yellow-300 bg-yellow-100 text-yellow-900 hover:bg-yellow-200",
		dot: "border border-yellow-400 bg-yellow-200",
		tone: "text-yellow-700",
	},
	pending: {
		chip: "btn-outline btn-info",
		dot: "bg-info",
		tone: "text-info",
	},
	"not-graded": {
		chip: "btn-outline border-base-content/20 text-base-content/50",
		dot: "border border-dashed border-base-content/40",
		tone: "text-base-content/50",
	},
};

/// The states in the order of the legend.
export const MARKS: readonly QuestionMark[] = [
	"correct",
	"partial",
	"wrong",
	"blank",
	"changed",
	"pending",
	"not-graded",
];

/// The name of a state.
export function markLabel(mark: QuestionMark): string {
	switch (mark) {
		case "correct":
			return m.grades_adjustment_mark_correct();
		case "partial":
			return m.grades_adjustment_mark_partial();
		case "wrong":
			return m.grades_adjustment_mark_wrong();
		case "blank":
			return m.grades_adjustment_mark_blank();
		case "changed":
			return m.grades_adjustment_changed_by_hand();
		case "pending":
			return m.grades_adjustment_mark_pending();
		case "not-graded":
			return m.grades_adjustment_mark_not_graded();
	}
}
