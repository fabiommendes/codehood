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

/**
 * Creates a terminal in `container`, loading xterm.js and its links addon
 * with dynamic `import()` on the first call; never imported statically.
 *
 * Screen reader mode is on, so the output is also exposed as text.
 */
export async function createTerminal(
	_container: HTMLElement,
): Promise<RunnerTerminal> {
	throw new Error("not implemented");
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
	_url: string,
	_confirm: (message: string) => boolean = window.confirm,
	_open: typeof window.open = window.open,
): boolean {
	throw new Error("not implemented");
}
