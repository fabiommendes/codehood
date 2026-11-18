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
