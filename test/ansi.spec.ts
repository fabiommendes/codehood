/**
 * `parseAnsi`: terminal output with escapes into styled text segments.
 */
import { expect, test } from "@playwright/test";
import { parseAnsi } from "@/utils/ansi";

const E = "\x1b";

test("plain text is one unstyled segment", () => {
	expect(parseAnsi("hello\nworld")).toEqual([
		{ text: "hello\nworld", style: {} },
	]);
	expect(parseAnsi("")).toEqual([]);
});

test("a color applies until its reset", () => {
	expect(parseAnsi(`a${E}[31mb${E}[0mc`)).toEqual([
		{ text: "a", style: {} },
		{ text: "b", style: { fg: { kind: "basic", index: 1 } } },
		{ text: "c", style: {} },
	]);
});

test("styles accumulate, and their own resets undo them one by one", () => {
	const fg = { kind: "basic", index: 2 } as const;
	expect(parseAnsi(`${E}[1;4;32ma${E}[22mb${E}[24mc${E}[39md`)).toEqual([
		{ text: "a", style: { bold: true, underline: true, fg } },
		{ text: "b", style: { underline: true, fg } },
		{ text: "c", style: { fg } },
		{ text: "d", style: {} },
	]);
});

test("dim, italic and background colors", () => {
	expect(parseAnsi(`${E}[2;3;104mx${E}[23;49mz`)).toEqual([
		{
			text: "x",
			style: { dim: true, italic: true, bg: { kind: "basic", index: 12 } },
		},
		{ text: "z", style: { dim: true } },
	]);
});

test("bright colors map to the second half of the basic palette", () => {
	expect(parseAnsi(`${E}[91mx`)).toEqual([
		{ text: "x", style: { fg: { kind: "basic", index: 9 } } },
	]);
});

test("256-color and truecolor, with ; and : separators", () => {
	expect(parseAnsi(`${E}[38;5;202mx${E}[48;2;1;2;3my`)).toEqual([
		{ text: "x", style: { fg: { kind: "palette", index: 202 } } },
		{
			text: "y",
			style: {
				fg: { kind: "palette", index: 202 },
				bg: { kind: "rgb", r: 1, g: 2, b: 3 },
			},
		},
	]);
	expect(parseAnsi(`${E}[38:2::9:8:7mx`)).toEqual([
		{ text: "x", style: { fg: { kind: "rgb", r: 9, g: 8, b: 7 } } },
	]);
});

test("an empty SGR is a reset", () => {
	expect(parseAnsi(`${E}[1ma${E}[mb`)).toEqual([
		{ text: "a", style: { bold: true } },
		{ text: "b", style: {} },
	]);
});

test("other escapes are dropped without leaking control characters", () => {
	const out = parseAnsi(`a${E}[2Kb${E}[10;5Hc${E}]0;title\x07d${E}5e${E}[`);
	expect(out.map((s) => s.text).join("")).toBe("abcd5e");
	for (const s of out) expect(s.text).not.toContain(E);
});

test("an OSC 8 link is dropped and its text kept", () => {
	const link = `${E}]8;;https://example.com${E}\\click${E}]8;;${E}\\`;
	expect(parseAnsi(`see ${link} now`)).toEqual([
		{ text: "see click now", style: {} },
	]);
	const bell = `${E}]8;;https://example.com\x07click${E}]8;;\x07`;
	expect(parseAnsi(bell)).toEqual([{ text: "click", style: {} }]);
});

test("a malformed color parameter list is ignored", () => {
	expect(parseAnsi(`${E}[38;5mx${E}[38;2;1mz`)).toEqual([
		{ text: "xz", style: {} },
	]);
});
