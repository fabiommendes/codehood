import type { AstroGlobal } from "astro";
import { type LoadGradingResult, loadGrading } from "@/utils/load-grading";

/// What a mockup page passes down once the visitor is allowed in.
export type Grading = Exclude<LoadGradingResult, { redirect: Response }>;

/**
 * Loads the grading context the mockups render over, or the response that refuses the visitor.
 *
 * Only a page can return that response, so every page calls this and hands the result to its frame.
 */
export function guard(Astro: AstroGlobal): Promise<LoadGradingResult> {
	return loadGrading(Astro, "cs101", "ada_2026-2", "quiz-01");
}
