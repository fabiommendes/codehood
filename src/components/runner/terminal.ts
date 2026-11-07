/**
 * The terminal of the code runner widget: xterm.js behind a small interface,
 * loaded on demand.
 *
 * xterm.js runs without the clipboard addon, so OSC 52 sequences in the
 * program's output cannot touch the clipboard. Links, plain URLs and OSC 8
 * hyperlinks alike, go through `openOutputLink`. Program output reaches the
 * page only through `RunnerTerminal.write`, never as HTML.
 *
 * Line editing is this module's own, with no addon: printable characters,
 * Backspace, Left/Right, Home/End, Up/Down through the history of the
 * current widget, Enter, Ctrl+C and Ctrl+D.
 */

import { m } from "@/i18n";

/** What the widget needs from a terminal. */
export interface RunnerTerminal {
	/** Writes program output; stderr is shown in the error color. */
	write(stream: "stdout" | "stderr", text: string): void;

	/** Echoes a line the user entered, in the input color, with a newline. */
	echoInput(line: string): void;

	/** Writes a line of the widget's own (exit summary, notices), dimmed. */
	notice(text: string): void;

	clear(): void;

	/**
	 * Reads one line typed in the terminal, with line editing and history.
	 *
	 * Resolves with the line without its newline, or `null` on Ctrl+D. The
	 * line is already echoed. Only one read is pending at a time.
	 */
	readLine(): Promise<string | null>;

	/** Cancels a pending `readLine`, which resolves with `null`. */
	cancelRead(): void;

	/** Registers the Ctrl+C handler. */
	onInterrupt(handler: () => void): void;

	focus(): void;
	dispose(): void;
}

/// ANSI sequences for the colors the widget uses.
const SGR = {
	reset: "\x1b[0m",
	error: "\x1b[38;2;244;135;113m",
	input: "\x1b[38;2;156;220;254m",
	dim: "\x1b[2;38;2;133;133;133m",
};

/// The result of feeding input to a `LineEditor`.
export interface LineEditResult {
	/// What to write to the terminal to show the edit.
	output: string;
	/// The submitted line (Enter), `null` for end of input (Ctrl+D on an
	/// empty line), `undefined` while editing goes on.
	submitted: string | null | undefined;
	/// Ctrl+C was pressed.
	interrupted: boolean;
}

/**
 * Line editor behind `RunnerTerminal.readLine`: pure, it turns the strings
 * xterm.js reports for key presses into the text to echo and the finished line.
 *
 * Input after Enter, Ctrl+D or Ctrl+C in the same chunk is dropped.
 *
 * @example
 * const editor = new LineEditor();
 * editor.feed("ab\x1b[Dc"); // shows "abc" with the cursor before "b"
 * editor.feed("\r").submitted; // "acb"
 */
export class LineEditor {
	private buffer: string[] = [];
	private cursor = 0;
	private history: string[] = [];
	/// Position in `history` while browsing it; `history.length` is the draft.
	private position = 0;
	private draft = "";

	/** Feeds one chunk of terminal input. */
	feed(data: string): LineEditResult {
		let output = "";
		let rest = data;
		while (rest.length > 0) {
			// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal escape sequences
			const seq = /^\x1b(?:\[([0-9;]*)([A-Za-z~])|O([A-Za-z]))/.exec(rest);
			if (seq) {
				rest = rest.slice(seq[0].length);
				output += this.pressKey(
					seq[2] === "~"
						? `~${seq[1]?.split(";")[0]}`
						: (seq[2] ?? seq[3] ?? ""),
				);
				continue;
			}
			const char = String.fromCodePoint(rest.codePointAt(0) ?? 0);
			rest = rest.slice(char.length);
			switch (char) {
				case "\r":
				case "\n": {
					const line = this.buffer.join("");
					this.remember(line);
					this.reset();
					return {
						output: `${output}\r\n`,
						submitted: line,
						interrupted: false,
					};
				}
				case "\x03":
					this.reset();
					return {
						output: `${output}^C\r\n`,
						submitted: undefined,
						interrupted: true,
					};
				case "\x04":
					if (this.buffer.length === 0) {
						return { output, submitted: null, interrupted: false };
					}
					break;
				case "\x7f":
				case "\b":
					output += this.backspace();
					break;
				case "\x01":
					output += this.pressKey("H");
					break;
				case "\x05":
					output += this.pressKey("F");
					break;
				case "\x1b":
					break;
				default:
					if (char >= " ") output += this.insert(char);
			}
		}
		return { output, submitted: undefined, interrupted: false };
	}

	/** Forgets the line being edited, keeping the history. */
	reset(): void {
		this.buffer = [];
		this.cursor = 0;
		this.position = this.history.length;
		this.draft = "";
	}

	private remember(line: string): void {
		if (line !== "" && this.history.at(-1) !== line) this.history.push(line);
	}

	private pressKey(key: string): string {
		switch (key) {
			case "D":
				return this.moveTo(this.cursor - 1);
			case "C":
				return this.moveTo(this.cursor + 1);
			case "H":
			case "~1":
			case "~7":
				return this.moveTo(0);
			case "F":
			case "~4":
			case "~8":
				return this.moveTo(this.buffer.length);
			case "~3":
				return this.erase();
			case "A":
				return this.browse(this.position - 1);
			case "B":
				return this.browse(this.position + 1);
			default:
				return "";
		}
	}

	private moveTo(target: number): string {
		const clamped = Math.max(0, Math.min(this.buffer.length, target));
		const delta = clamped - this.cursor;
		this.cursor = clamped;
		if (delta < 0) return `\x1b[${-delta}D`;
		return delta > 0 ? `\x1b[${delta}C` : "";
	}

	private insert(char: string): string {
		this.buffer.splice(this.cursor, 0, char);
		this.cursor += 1;
		return char + this.tail();
	}

	private backspace(): string {
		if (this.cursor === 0) return "";
		this.cursor -= 1;
		this.buffer.splice(this.cursor, 1);
		return `\x1b[D${this.tail()}`;
	}

	private erase(): string {
		if (this.cursor >= this.buffer.length) return "";
		this.buffer.splice(this.cursor, 1);
		return this.tail();
	}

	/// Rewrites the text after the cursor, erases what is left of the old
	/// line and puts the cursor back.
	private tail(): string {
		const rest = this.buffer.slice(this.cursor).join("");
		const back = this.buffer.length - this.cursor;
		return `${rest}\x1b[K${back > 0 ? `\x1b[${back}D` : ""}`;
	}

	private browse(target: number): string {
		if (target < 0 || target > this.history.length) return "";
		if (this.position === this.history.length) {
			this.draft = this.buffer.join("");
		}
		this.position = target;
		const text =
			target === this.history.length
				? this.draft
				: (this.history[target] ?? "");
		const back = this.cursor > 0 ? `\x1b[${this.cursor}D` : "";
		this.buffer = [...text];
		this.cursor = this.buffer.length;
		return `${back}${text}\x1b[K`;
	}
}

/// Adds xterm's stylesheet to the page once. It is fetched by URL because a
/// dynamically imported CSS module is inlined into the server bundle by the
/// build, leaving the client chunk pointing at a file that does not exist.
async function loadXtermStyles(): Promise<void> {
	const { default: href } = await import("@xterm/xterm/css/xterm.css?url");
	if (document.querySelector(`link[href="${href}"]`)) return;
	await new Promise<void>((resolve) => {
		const link = document.createElement("link");
		link.rel = "stylesheet";
		link.href = href;
		link.onload = () => resolve();
		link.onerror = () => resolve();
		document.head.append(link);
	});
}

/**
 * Creates a terminal in `container`, loading xterm.js and its links addon
 * with dynamic `import()` on the first call; never imported statically.
 *
 * Screen reader mode is on, so the output is also exposed as text.
 */
export async function createTerminal(
	container: HTMLElement,
): Promise<RunnerTerminal> {
	const [{ Terminal }, { WebLinksAddon }, { FitAddon }] = await Promise.all([
		import("@xterm/xterm"),
		import("@xterm/addon-web-links"),
		import("@xterm/addon-fit"),
		loadXtermStyles(),
	]);

	const terminal = new Terminal({
		screenReaderMode: true,
		convertEol: true,
		cursorBlink: true,
		fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		fontSize: 13,
		rows: 8,
		theme: {
			background: "#181818",
			foreground: "#d4d4d4",
			cursor: "#aeafad",
		},
		linkHandler: {
			activate: (_event, uri) => {
				openOutputLink(uri);
			},
			allowNonHttpProtocols: false,
		},
	});
	const fit = new FitAddon();
	terminal.loadAddon(fit);
	terminal.loadAddon(
		new WebLinksAddon((_event, uri) => {
			openOutputLink(uri);
		}),
	);
	terminal.open(container);
	const refit = () => {
		try {
			fit.fit();
		} catch {
			// The container has no size yet (hidden); the next resize retries.
		}
	};
	refit();
	const observer = new ResizeObserver(refit);
	observer.observe(container);

	const editor = new LineEditor();
	let pending: ((line: string | null) => void) | null = null;
	let interrupt: () => void = () => {};

	const settle = (line: string | null) => {
		const resolve = pending;
		pending = null;
		resolve?.(line);
	};

	const data = terminal.onData((input) => {
		if (pending === null && !input.includes("\x03")) return;
		const result = editor.feed(input);
		terminal.write(result.output);
		if (result.interrupted) interrupt();
		else if (result.submitted !== undefined) settle(result.submitted);
	});

	return {
		write(stream, text) {
			terminal.write(
				stream === "stderr" ? `${SGR.error}${text}${SGR.reset}` : text,
			);
		},
		echoInput(line) {
			terminal.write(`${SGR.input}${line}${SGR.reset}\r\n`);
		},
		notice(text) {
			terminal.write(`${SGR.dim}${text}${SGR.reset}\r\n`);
		},
		clear() {
			settle(null);
			editor.reset();
			terminal.reset();
		},
		readLine() {
			settle(null);
			editor.reset();
			return new Promise((resolve) => {
				pending = resolve;
			});
		},
		cancelRead() {
			editor.reset();
			settle(null);
		},
		onInterrupt(handler) {
			interrupt = handler;
		},
		focus() {
			terminal.focus();
		},
		dispose() {
			settle(null);
			data.dispose();
			observer.disconnect();
			terminal.dispose();
		},
	};
}

/**
 * Opens a link from the program's output in a new tab, after the user confirms.
 *
 * Only `http:` and `https:` URLs; anything else is ignored. The confirmation
 * shows the full URL as parsed by `new URL(url).href`, the address that will
 * actually open, not the link's text. Opens with `noopener` and `noreferrer`.
 *
 * @returns whether the link was opened.
 */
export function openOutputLink(
	url: string,
	confirm: (message: string) => boolean = window.confirm,
	open: typeof window.open = window.open,
): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	if (!confirm(m.runner_confirm_link({ url: parsed.href }))) return false;
	open(parsed.href, "_blank", "noopener,noreferrer");
	return true;
}
