/// A color of an SGR sequence: one of the 16 basic colors, the 256 palette or truecolor.
export type AnsiColor =
	| { kind: "basic"; index: number }
	| { kind: "palette"; index: number }
	| { kind: "rgb"; r: number; g: number; b: number };

/** The text attributes in effect for a segment. Absent means off. */
export interface AnsiStyle {
	bold?: true;
	dim?: true;
	italic?: true;
	underline?: true;
	fg?: AnsiColor;
	bg?: AnsiColor;
}

/** A run of text with one style. */
export interface AnsiSegment {
	text: string;
	style: AnsiStyle;
}

/// CSI sequence, OSC sequence (BEL or ST terminated), or any other escape.
const ESCAPE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes
	/\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[@-~]?/g;

/// Reads the extended color that starts at `params[i]` (after 38 or 48), and the index after it.
function extendedColor(
	params: number[],
	i: number,
): [AnsiColor | null, number] {
	if (params[i] === 5) {
		const index = params[i + 1];
		if (index === undefined || index > 255) return [null, i + 2];
		return [{ kind: "palette", index }, i + 2];
	}
	if (params[i] === 2) {
		const [r, g, b] = [params[i + 1], params[i + 2], params[i + 3]];
		if (r === undefined || g === undefined || b === undefined) {
			return [null, params.length];
		}
		if (r > 255 || g > 255 || b > 255) return [null, i + 4];
		return [{ kind: "rgb", r, g, b }, i + 4];
	}
	return [null, params.length];
}

/// Applies one SGR parameter list to `style`.
function applySgr(style: AnsiStyle, raw: string): AnsiStyle {
	const next = { ...style };
	const params = (raw === "" ? "0" : raw).split(";").flatMap((group) => {
		const parts = group.split(":").map((p) => (p === "" ? 0 : Number(p)));
		// `38:2:<colorspace>:r:g:b` carries an extra, ignored, colorspace id.
		if (parts.length > 5 && parts[1] === 2) parts.splice(2, 1);
		return parts;
	});
	for (let i = 0; i < params.length; i++) {
		const p = params[i] as number;
		if (p === 0) {
			for (const key of Object.keys(next)) delete next[key as keyof AnsiStyle];
		} else if (p === 1) next.bold = true;
		else if (p === 2) next.dim = true;
		else if (p === 3) next.italic = true;
		else if (p === 4) next.underline = true;
		else if (p === 22) {
			delete next.bold;
			delete next.dim;
		} else if (p === 23) delete next.italic;
		else if (p === 24) delete next.underline;
		else if (p >= 30 && p <= 37) next.fg = { kind: "basic", index: p - 30 };
		else if (p >= 90 && p <= 97) next.fg = { kind: "basic", index: p - 82 };
		else if (p >= 40 && p <= 47) next.bg = { kind: "basic", index: p - 40 };
		else if (p >= 100 && p <= 107) next.bg = { kind: "basic", index: p - 92 };
		else if (p === 39) delete next.fg;
		else if (p === 49) delete next.bg;
		else if (p === 38 || p === 48) {
			const [color, after] = extendedColor(params, i + 1);
			if (color) next[p === 38 ? "fg" : "bg"] = color;
			i = after - 1;
		}
	}
	return next;
}

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Splits terminal output into runs of text with their SGR style.
 *
 * Every escape other than SGR (cursor moves, OSC such as hyperlinks, lone
 * ESC) is dropped and its visible text kept. Adjacent runs of equal style are
 * merged.
 */
export function parseAnsi(text: string): AnsiSegment[] {
	const segments: AnsiSegment[] = [];
	let style: AnsiStyle = {};
	const push = (chunk: string) => {
		if (chunk === "") return;
		const last = segments[segments.length - 1];
		if (last && sameStyle(last.style, style)) last.text += chunk;
		else segments.push({ text: chunk, style });
	};
	let at = 0;
	for (const match of text.matchAll(ESCAPE)) {
		push(text.slice(at, match.index));
		at = match.index + match[0].length;
		if (match[2] === "m") style = applySgr(style, match[1] ?? "");
	}
	push(text.slice(at));
	return segments;
}
