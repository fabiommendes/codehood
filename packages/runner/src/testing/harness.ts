/**
 * Drives the runner frame with raw protocol messages: a page of the app
 * embeds `<runnerOrigin>/runner/frame` and records everything the frame
 * posts, as the app side of the protocol would see it.
 *
 * For Playwright tests: `runnerHarness` binds the helpers to a server.
 */

import { randomUUID } from "node:crypto";
import type { Frame, Page } from "@playwright/test";
import type { RunnerToAppMessage } from "../protocol";

export type RunnerMessage = RunnerToAppMessage;

interface RunnerWindow extends Window {
	__runnerMessages: Record<string, unknown>[];
}

/// A language id; `fake` is the test driver.
export type Language = string;

/// Where the frame is served and which app page hosts it.
export interface HarnessServer {
	/// URL (or path, against the test's `baseURL`) of a page of the app.
	appPage: string;
	runnerOrigin: string;
}

/// A frame loaded into an app page, plus the page that hosts it.
export interface Harness {
	page: Page;
	frame: Frame;
	/// Messages the frame posted before `ready` was observed, `ready` included.
	ready: Extract<RunnerMessage, { type: "ready" }>;
}

/** Everything the frame posted so far, in order. */
export async function allMessages(
	h: Pick<Harness, "page">,
): Promise<Record<string, unknown>[]> {
	return h.page.evaluate(
		() => (window as unknown as RunnerWindow).__runnerMessages,
	);
}

/**
 * Loads (or replaces) the runner iframe of `page` and waits for its `ready`.
 *
 * `query` is appended to the frame URL (`?isolation=off`, `?exclusive=1`).
 */
async function loadFrame(
	server: HarnessServer,
	page: Page,
	query = "",
	{ navigate = true }: { navigate?: boolean } = {},
): Promise<Harness> {
	if (navigate) await page.goto(server.appPage);
	await page.evaluate(
		({ origin, query }) => {
			const w = window as unknown as RunnerWindow;
			document.getElementById("runner-frame")?.remove();
			w.__runnerMessages = [];
			const iframe = document.createElement("iframe");
			iframe.id = "runner-frame";
			window.addEventListener("message", (event) => {
				if (event.origin === origin && event.source === iframe.contentWindow) {
					w.__runnerMessages.push(event.data);
				}
			});
			iframe.src = `${origin}/runner/frame${query}`;
			document.body.append(iframe);
		},
		{ origin: server.runnerOrigin, query },
	);
	await page.waitForFunction(
		() =>
			(window as unknown as RunnerWindow).__runnerMessages.some(
				(m) => m.type === "ready",
			),
		undefined,
		{ timeout: 20_000 },
	);
	const handle = await page.locator("#runner-frame").elementHandle();
	const frame = await handle?.contentFrame();
	if (!frame) throw new Error("runner frame did not attach");
	const ready = (await allMessages({ page })).find(
		(m) => m.type === "ready",
	) as Harness["ready"];
	return { page, frame, ready };
}

/// Posts a raw protocol message to the frame, as the app does.
async function send(
	server: HarnessServer,
	h: Pick<Harness, "page">,
	message: Record<string, unknown>,
): Promise<void> {
	await h.page.evaluate(
		({ message, origin }) => {
			const iframe = document.getElementById(
				"runner-frame",
			) as HTMLIFrameElement;
			iframe.contentWindow?.postMessage(message, origin);
		},
		{ message, origin: server.runnerOrigin },
	);
}

/** Everything the frame posted so far for `runId`. */
export async function messagesOf(
	h: Pick<Harness, "page">,
	runId: string,
): Promise<RunnerMessage[]> {
	return (await h.page.evaluate(
		(id) =>
			(window as unknown as RunnerWindow).__runnerMessages.filter(
				(m) => m.runId === id,
			),
		runId,
	)) as RunnerMessage[];
}

/** Waits until the frame posted an `exit`, or a `status` with `state`, for `runId`. */
export async function waitFor(
	h: Pick<Harness, "page">,
	runId: string,
	type: "exit" | "status",
	state?: string,
	timeout = 30_000,
): Promise<void> {
	await h.page.waitForFunction(
		({ id, type, state }) =>
			(window as unknown as RunnerWindow).__runnerMessages.some(
				(m) =>
					m.runId === id && m.type === type && (!state || m.state === state),
			),
		{ id: runId, type, state },
		{ timeout },
	);
}

/// Options of a run started by the harness.
export interface StartOptions {
	runId?: string;
	mode?: "script" | "repl";
	extra?: Record<string, unknown>;
}

/// Entry file name of a run, per language; `main.<id>` for the others.
const ENTRY: Record<string, string> = {
	elm: "Main.elm",
	javascript: "main.js",
	lua: "main.lua",
	prolog: "main.pl",
	python: "main.py",
	typescript: "main.ts",
	fake: "main.fake",
};

/** The `run` message for `code`, with the entry file name the language expects. */
export function runMessage(
	runId: string,
	code: string,
	language: Language = "fake",
	mode: "script" | "repl" = "script",
	extra: Record<string, unknown> = {},
) {
	const entry = ENTRY[language] ?? `main.${language}`;
	return {
		type: "run",
		runId,
		language,
		mode,
		files: { [entry]: code },
		entry,
		...extra,
	};
}

/// Starts a run without waiting for it; returns its id.
async function start(
	server: HarnessServer,
	h: Pick<Harness, "page">,
	code: string,
	language: Language = "fake",
	{ runId = randomUUID(), mode = "script", extra = {} }: StartOptions = {},
): Promise<string> {
	await send(server, h, runMessage(runId, code, language, mode, extra));
	return runId;
}

/// What a finished run produced.
export interface RunResult {
	runId: string;
	stdout: string;
	stderr: string;
	exit: Extract<RunnerMessage, { type: "exit" }>;
	messages: RunnerMessage[];
}

/** Waits for the run to end and gathers what the page saw of it. */
export async function collect(
	h: Pick<Harness, "page">,
	runId: string,
	timeout = 30_000,
): Promise<RunResult> {
	await waitFor(h, runId, "exit", undefined, timeout);
	const messages = await messagesOf(h, runId);
	const text = (stream: string) =>
		messages
			.filter((m) => m.type === "output" && m.stream === stream)
			.map((m) => (m as { text: string }).text)
			.join("");
	const exit = messages.find((m) => m.type === "exit") as RunResult["exit"];
	return {
		runId,
		stdout: text("stdout"),
		stderr: text("stderr"),
		exit,
		messages,
	};
}

/// Runs `code` to its end.
async function run(
	server: HarnessServer,
	h: Pick<Harness, "page">,
	code: string,
	language: Language = "fake",
	options: StartOptions = {},
): Promise<RunResult> {
	return collect(h, await start(server, h, code, language, options));
}

/** The `status` states of a run, in order. */
export function statesOf(messages: RunnerMessage[]): string[] {
	return messages.flatMap((m) => (m.type === "status" ? [m.state] : []));
}

/**
 * The harness helpers bound to `server`.
 *
 * @example
 * const { loadFrame, run } = runnerHarness({ appPage: "/", runnerOrigin });
 */
export function runnerHarness(server: HarnessServer) {
	return {
		loadFrame: (page: Page, query?: string, options?: { navigate?: boolean }) =>
			loadFrame(server, page, query, options),
		send: (h: Pick<Harness, "page">, message: Record<string, unknown>) =>
			send(server, h, message),
		start: (
			h: Pick<Harness, "page">,
			code: string,
			language?: Language,
			options?: StartOptions,
		) => start(server, h, code, language, options),
		run: (
			h: Pick<Harness, "page">,
			code: string,
			language?: Language,
			options?: StartOptions,
		) => run(server, h, code, language, options),
		allMessages,
		messagesOf,
		waitFor,
		collect,
		runMessage,
		statesOf,
	};
}
