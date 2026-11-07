import { expect, test } from "@playwright/test";
import { LineEditor, openOutputLink } from "@/components/runner/terminal";

/// Replays the editor's output on a one-line screen, to compare what the
/// user would see and where the cursor ends up.
function screen(chunks: string[]): { text: string; cursor: number } {
	let text: string[] = [];
	let cursor = 0;
	const out = chunks.join("");
	for (let i = 0; i < out.length; ) {
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal escape sequences
		const csi = /^\x1b\[(\d*)([DCK])/.exec(out.slice(i));
		if (csi) {
			const n = csi[1] === "" ? 1 : Number(csi[1]);
			if (csi[2] === "D") cursor = Math.max(0, cursor - n);
			else if (csi[2] === "C") cursor += n;
			else text = text.slice(0, cursor);
			i += csi[0].length;
			continue;
		}
		const char = out[i] as string;
		if (char === "\r" || char === "\n") {
			i += 1;
			continue;
		}
		text[cursor] = char;
		cursor += 1;
		i += 1;
	}
	return { text: text.join(""), cursor };
}

function type(editor: LineEditor, ...inputs: string[]) {
	const outputs: string[] = [];
	let last = editor.feed("");
	for (const input of inputs) {
		last = editor.feed(input);
		outputs.push(last.output);
	}
	return { ...last, screen: screen(outputs) };
}

const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const HOME = "\x1b[H";
const END = "\x1b[F";
const DELETE = "\x1b[3~";

test.describe("LineEditor", () => {
	test("Enter submits the typed characters", () => {
		const editor = new LineEditor();
		type(editor, "hello");
		const result = editor.feed("\r");
		expect(result.submitted).toBe("hello");
		expect(result.output).toBe("\r\n");
	});

	test("Backspace deletes before the cursor", () => {
		const editor = new LineEditor();
		const result = type(editor, "abc", "\x7f", "\x7f", "x");
		expect(result.screen).toEqual({ text: "ax", cursor: 2 });
		expect(editor.feed("\r").submitted).toBe("ax");
	});

	test("Backspace at the start does nothing", () => {
		const editor = new LineEditor();
		expect(editor.feed("\x7f").output).toBe("");
	});

	test("arrows edit in the middle", () => {
		const editor = new LineEditor();
		const result = type(editor, "ac", LEFT, "b");
		expect(result.screen).toEqual({ text: "abc", cursor: 2 });
		expect(editor.feed("\r").submitted).toBe("abc");
	});

	test("Backspace in the middle redraws the tail", () => {
		const editor = new LineEditor();
		const result = type(editor, "abcd", LEFT, LEFT, "\x7f");
		expect(result.screen).toEqual({ text: "acd", cursor: 1 });
	});

	test("Home, End and Delete", () => {
		const editor = new LineEditor();
		type(editor, "bcd", HOME, "a", END, "e", HOME, RIGHT, DELETE);
		expect(editor.feed("\r").submitted).toBe("acde");
	});

	test("cursor stays inside the line", () => {
		const editor = new LineEditor();
		expect(editor.feed(LEFT).output).toBe("");
		editor.feed("ab");
		expect(editor.feed(RIGHT).output).toBe("");
	});

	test("history walks back and forth and keeps the draft", () => {
		const editor = new LineEditor();
		for (const line of ["one", "two"]) {
			editor.feed(line);
			editor.feed("\r");
		}
		const result = type(editor, "dr", UP, UP, DOWN);
		expect(result.screen.text).toBe("two");
		expect(type(editor, DOWN).screen.text).toBe("dr");
		expect(editor.feed("\r").submitted).toBe("dr");
	});

	test("history does not go past its ends", () => {
		const editor = new LineEditor();
		editor.feed("one\r");
		expect(editor.feed(DOWN).output).toBe("");
		editor.feed(UP);
		expect(editor.feed(UP).output).toBe("");
	});

	test("history skips empty lines and repeats", () => {
		const editor = new LineEditor();
		editor.feed("a\r");
		editor.feed("\r");
		editor.feed("a\r");
		editor.feed(UP);
		expect(editor.feed("\r").submitted).toBe("a");
		editor.feed(UP);
		editor.feed(UP);
		expect(editor.feed("\r").submitted).toBe("a");
	});

	test("an edited history entry is submitted as edited", () => {
		const editor = new LineEditor();
		editor.feed("abc\r");
		editor.feed(UP);
		editor.feed("\x7f");
		expect(editor.feed("\r").submitted).toBe("ab");
	});

	test("Ctrl+C interrupts and drops the line", () => {
		const editor = new LineEditor();
		editor.feed("abc");
		const result = editor.feed("\x03");
		expect(result.interrupted).toBe(true);
		expect(result.submitted).toBeUndefined();
		expect(editor.feed("\r").submitted).toBe("");
	});

	test("Ctrl+D on an empty line is end of input", () => {
		const editor = new LineEditor();
		expect(editor.feed("\x04").submitted).toBeNull();
	});

	test("Ctrl+D with text is ignored", () => {
		const editor = new LineEditor();
		editor.feed("a");
		expect(editor.feed("\x04").submitted).toBeUndefined();
		expect(editor.feed("\r").submitted).toBe("a");
	});

	test("control characters are not inserted", () => {
		const editor = new LineEditor();
		editor.feed("a\x07\x1bb\x00c");
		expect(editor.feed("\r").submitted).toBe("abc");
	});

	test("a pasted chunk is inserted whole; input after Enter is dropped", () => {
		const editor = new LineEditor();
		const result = editor.feed("first\rsecond");
		expect(result.submitted).toBe("first");
		expect(editor.feed("\r").submitted).toBe("");
	});

	test("characters outside the BMP count as one", () => {
		const editor = new LineEditor();
		type(editor, "a😀b", LEFT, "\x7f");
		expect(editor.feed("\r").submitted).toBe("ab");
	});
});

test.describe("openOutputLink", () => {
	function harness(answer: boolean) {
		const calls = { confirm: [] as string[], open: [] as unknown[][] };
		return {
			calls,
			link: (url: string) =>
				openOutputLink(
					url,
					(message) => {
						calls.confirm.push(message);
						return answer;
					},
					((...args: unknown[]) => {
						calls.open.push(args);
						return null;
					}) as typeof window.open,
				),
		};
	}

	test("opens a confirmed https link with noopener and noreferrer", () => {
		const { calls, link } = harness(true);
		expect(link("https://example.com/a?b=1")).toBe(true);
		expect(calls.open).toEqual([
			["https://example.com/a?b=1", "_blank", "noopener,noreferrer"],
		]);
	});

	test("accepts http", () => {
		const { link } = harness(true);
		expect(link("http://example.com/")).toBe(true);
	});

	test("does not open without confirmation", () => {
		const { calls, link } = harness(false);
		expect(link("https://example.com/")).toBe(false);
		expect(calls.confirm).toHaveLength(1);
		expect(calls.open).toEqual([]);
	});

	test("refuses javascript:, data:, file: and garbage without asking", () => {
		const { calls, link } = harness(true);
		for (const url of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"file:///etc/passwd",
			"blob:https://example.com/x",
			"not a url",
			"",
		]) {
			expect(link(url)).toBe(false);
		}
		expect(calls.confirm).toEqual([]);
		expect(calls.open).toEqual([]);
	});

	test("the confirmation shows the normalized URL in full", () => {
		const { calls, link } = harness(true);
		link("HTTPS://Exemplo.com.evil.test");
		expect(calls.confirm[0]).toContain("https://exemplo.com.evil.test/");
	});

	test("the confirmation shows the address that opens, credentials included", () => {
		const { calls, link } = harness(true);
		link("https://exemplo.com@evil.test/x");
		expect(calls.confirm[0]).toContain("https://exemplo.com@evil.test/x");
		expect(calls.open[0]?.[0]).toBe("https://exemplo.com@evil.test/x");
	});
});
