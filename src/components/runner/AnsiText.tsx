import type { JSX } from "solid-js";
import { For } from "solid-js";
import { type AnsiColor, type AnsiSegment, parseAnsi } from "@/utils/ansi";

/// Theme classes of the 16 basic colors, in SGR order; bright ones repeat the normal ones.
const BASIC = [
	"text-base-content/50",
	"text-error",
	"text-success",
	"text-warning",
	"text-info",
	"text-secondary",
	"text-info",
	"text-base-content/70",
];

/// The 6x6x6 cube and gray ramp of the 256-color palette as an `rgb()` value.
function paletteColor(index: number): string {
	if (index >= 232) {
		const level = 8 + (index - 232) * 10;
		return `rgb(${level} ${level} ${level})`;
	}
	const n = index - 16;
	const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
	return `rgb(${level(Math.floor(n / 36))} ${level(Math.floor(n / 6) % 6)} ${level(n % 6)})`;
}

/// The CSS color of a color outside the 16 basic ones, or undefined.
function cssColor(color: AnsiColor): string | undefined {
	if (color.kind === "rgb") return `rgb(${color.r} ${color.g} ${color.b})`;
	if (color.kind === "palette" && color.index >= 16) {
		return paletteColor(color.index);
	}
	return undefined;
}

/// The theme slot of a color that `cssColor` left out, which is always a basic or low palette index.
function slot(color: AnsiColor): number {
	return color.kind === "rgb" ? 0 : color.index % 8;
}

/// Background classes of the 16 basic colors, softened so the text stays readable.
const BASIC_BG = [
	"bg-base-content/20",
	"bg-error/25",
	"bg-success/25",
	"bg-warning/25",
	"bg-info/25",
	"bg-secondary/25",
	"bg-info/25",
	"bg-base-content/10",
];

/// The class and inline style of one segment.
function segmentProps(segment: AnsiSegment): {
	class: string;
	style: JSX.CSSProperties;
} {
	const { fg, bg, bold, dim, italic, underline } = segment.style;
	const classes: string[] = [];
	const style: JSX.CSSProperties = {};
	if (fg) {
		const css = cssColor(fg);
		if (css) style.color = css;
		else classes.push(BASIC[slot(fg)] as string);
	}
	if (bg) {
		const css = cssColor(bg);
		if (css) style["background-color"] = css;
		else classes.push(BASIC_BG[slot(bg)] as string);
	}
	if (bold) classes.push("font-bold");
	if (dim) classes.push("opacity-60");
	if (italic) classes.push("italic");
	if (underline) classes.push("underline");
	return { class: classes.join(" "), style };
}

/**
 * Text with ANSI color escapes, rendered as styled spans.
 *
 * Basic colors follow the DaisyUI theme; 256-color and truecolor values are
 * inline. The text is never parsed as HTML.
 */
export function AnsiText(props: { text: string }): JSX.Element {
	return (
		<For each={parseAnsi(props.text)}>
			{(segment) => {
				const p = segmentProps(segment);
				return (
					<span
						class={p.class || undefined}
						style={Object.keys(p.style).length > 0 ? p.style : undefined}
						data-ansi={Object.keys(segment.style).length > 0 ? "" : undefined}
					>
						{segment.text}
					</span>
				);
			}}
		</For>
	);
}
