/**
 * Runs a DOM update inside a view transition, or right away when the browser
 * has none or the reader asked for reduced motion.
 */
export function withViewTransition(update: () => void): void {
	if (
		!document.startViewTransition ||
		matchMedia("(prefers-reduced-motion: reduce)").matches
	) {
		update();
		return;
	}
	document.startViewTransition(update);
}

/**
 * The view transition name of a course in the sidebar, the same for its row
 * and its card, so one morphs into the other between pages.
 *
 * @example
 * courseTransitionName("/cs101/ada_2026-2"); // "course--cs101-ada_2026-2"
 */
export function courseTransitionName(href: string): string {
	return `course-${href.replace(/[^\w-]/g, "-")}`;
}
