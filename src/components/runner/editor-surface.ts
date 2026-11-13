/// Wrapper classes of a code editor box, shared by the runner widget and the code answer so both look alike.

/// The wrapper whose overlay draws the focus ring above the editor's sticky gutter.
export const EDITOR_FOCUS_RING =
	"relative after:pointer-events-none after:absolute after:inset-0 after:z-[300] after:rounded-[inherit] after:transition-shadow after:content-[''] focus-within:after:shadow-[inset_0_0_0_1px_#569cd666,inset_0_0_14px_#569cd633]";

/// The dark scrolling surface the editor, or the highlighted code that stands for it, sits on.
export const EDITOR_SURFACE =
	"relative overflow-auto bg-[#1e1e1e] font-mono text-[13px] leading-5 text-[#d4d4d4]";
