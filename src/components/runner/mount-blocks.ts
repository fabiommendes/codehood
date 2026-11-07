/**
 * Turns the runnable code blocks of a rendered note into code runner widgets.
 */

import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { m } from "@/i18n";
import { runnerLanguage } from "@/runner/languages";
import CodeRunner from "./CodeRunner";

/// Class the Markdown renderer gives the wrapper of a block fenced with `run`
/// whose language has a driver. Its `data-language` always comes from
/// `runnerLanguage()`, never from the author's info string.
export const CODE_RUNNER_BLOCK_CLASS = "code-runner-block";

/// Class of the wrapper of a block fenced with `run` whose language has no
/// driver: the code stays static, followed by a discreet "code execution is
/// not available for this language" note rendered on the server.
export const CODE_RUNNER_UNAVAILABLE_CLASS = "code-runner-unavailable";

/**
 * Mounts a `CodeRunner` (mode `snippet`, `compact`) on each
 * `.code-runner-block` under `root`.
 *
 * The language comes from the wrapper's `data-language`, checked again with
 * `runnerLanguage()`, and the code from the `textContent` of its `<pre>`.
 * Blocks of `CODE_RUNNER_UNAVAILABLE_CLASS` are left alone. A block already
 * mounted is skipped, so calling it twice is harmless.
 */
export function mountCodeRunners(
	root: HTMLElement,
	runnerOrigin: string,
): void {
	const blocks = root.querySelectorAll<HTMLElement>(
		`.${CODE_RUNNER_BLOCK_CLASS}:not([data-mounted])`,
	);
	let number = 0;
	for (const block of blocks) {
		const language = runnerLanguage(block.dataset.language);
		const pre = block.querySelector("pre");
		if (!language || !pre) continue;
		number += 1;
		const code = pre.textContent ?? "";
		const highlightedHtml = pre.outerHTML;
		block.dataset.mounted = "";
		block.replaceChildren();
		render(
			() =>
				createComponent(CodeRunner, {
					mode: "snippet",
					compact: true,
					language,
					code,
					highlightedHtml,
					label: m.runner_block_label({ number }),
					runnerOrigin,
				}),
			block,
		);
	}
}
