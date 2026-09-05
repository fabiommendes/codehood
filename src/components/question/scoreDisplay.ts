/** How a score badge should read and look, shared by every review-mode view. */
export function scoreLabel(score: number): string {
	const magnitude = Math.abs(score).toFixed(2);
	return score < 0 ? `Score −${magnitude}` : `Score ${magnitude}`;
}

/** The `<Badge>` props a score renders with. */
export function scoreBadge(score: number): {
	variant: "success" | "error" | "neutral";
	style?: "ghost";
} {
	if (score > 0) return { variant: "success" };
	if (score < 0) return { variant: "error" };
	return { variant: "neutral", style: "ghost" };
}

/** The `<Alert>` variant a scalar-feedback message renders with. */
export function feedbackVariant(score: number): "success" | "error" | "info" {
	if (score > 0) return "success";
	if (score < 0) return "error";
	return "info";
}

/** What an ungraded answer's badge reads. */
export const PENDING_LABEL = "Awaiting grading";

/** The `<Badge>` props an ungraded answer renders with. */
export function pendingBadge(): { variant: "warning"; style: "soft" } {
	return { variant: "warning", style: "soft" };
}
