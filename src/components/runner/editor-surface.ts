/// Wrapper classes of a code editor box, shared by the runner widget and the code answer so both look alike.

/// The wrapper whose overlay draws the focus ring above the editor's sticky gutter.
export const EDITOR_FOCUS_RING =
	"relative after:pointer-events-none after:absolute after:inset-0 after:z-[300] after:rounded-[inherit] after:transition-shadow after:content-[''] focus-within:after:shadow-[inset_0_0_0_1px_var(--color-primary),inset_0_0_14px_color-mix(in_oklab,var(--color-primary)_20%,transparent)]";

/// The scrolling surface the editor, or the highlighted code that stands for it, sits on, in the colors of the site's code themes.
export const EDITOR_SURFACE =
	"relative overflow-auto bg-(--code-bg) font-mono text-(length:--code-font-size) leading-5 text-(--code-fg)";
