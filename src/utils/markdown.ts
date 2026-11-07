import MarkdownIt from "markdown-it";
import { m } from "@/i18n";
import { runnerLanguage } from "@/runner/languages";
import { highlightCode } from "./highlight-code";

/// The project's only MarkdownIt instance.
///
/// `html: false` is spelled out rather than left to the library's default:
/// every Markdown source here (question files, exam preambles, event
/// descriptions, resource notes) is authored by an instructor and rendered
/// into the app's own origin, so raw HTML in one of them would execute with
/// every reader's session. A default is not a guarantee across a major bump.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/// Wrapper class of a ```js run block whose language has a driver. Same
/// value as `CODE_RUNNER_BLOCK_CLASS` of `mount-blocks.ts`, which cannot be
/// imported here because it pulls in the widget.
const RUNNER_BLOCK_CLASS = "code-runner-block";

/// Wrapper class of a `run` block whose language has no driver.
const RUNNER_UNAVAILABLE_CLASS = "code-runner-unavailable";

const defaultFence = md.renderer.rules.fence;

/// Fenced blocks with `run` after the language become runnable placeholders,
/// or a static block with a note when no driver runs the language. The
/// language attribute comes from `runnerLanguage()`, never from the info
/// string, and the code stays escaped.
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
	const token = tokens[idx];
	if (!token) return "";
	const [tag, ...flags] = md.utils.unescapeAll(token.info).trim().split(/\s+/);
	if (!flags.includes("run")) {
		return (
			defaultFence?.(tokens, idx, options, env, self) ??
			self.renderToken(tokens, idx, options)
		);
	}
	const pre = `<pre><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
	const language = runnerLanguage(tag);
	if (language === null) {
		return `<div class="${RUNNER_UNAVAILABLE_CLASS}">${pre}<p class="text-xs text-muted">${md.utils.escapeHtml(m.runner_block_unavailable())}</p></div>\n`;
	}
	return `<div class="${RUNNER_BLOCK_CLASS}" data-language="${language}">${pre}</div>\n`;
};

const RUNNER_BLOCK_PATTERN = new RegExp(
	`<div class="${RUNNER_BLOCK_CLASS}" data-language="([a-z]+)"><pre><code>([\\s\\S]*?)</code></pre></div>`,
	"g",
);

/// Undoes `escapeHtml` of markdown-it, and nothing else.
function unescapeHtml(text: string): string {
	return text
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&amp;", "&");
}

/**
 * Highlights the code of the runnable blocks of rendered Markdown with VS
 * Code's themes, the ones of the editor that replaces them.
 */
export async function highlightRunnerBlocks(html: string): Promise<string> {
	const blocks = [...html.matchAll(RUNNER_BLOCK_PATTERN)];
	const highlighted = await Promise.all(
		blocks.map(([, language, escaped]) =>
			highlightCode(unescapeHtml(escaped ?? ""), language, { theme: "vscode" }),
		),
	);
	let index = 0;
	return html.replace(
		RUNNER_BLOCK_PATTERN,
		(_whole, language: string) =>
			`<div class="${RUNNER_BLOCK_CLASS}" data-language="${language}">${highlighted[index++]}</div>`,
	);
}

/** Renders a Markdown string as a block of sanitized HTML. */
export function renderMarkdown(text: string): string {
	return md.render(text);
}

/**
 * Renders a Markdown document whose title the page already shows, dropping
 * a level-one heading that opens it.
 */
export function renderMarkdownBody(text: string): string {
	const env = {};
	const tokens = md.parse(text, env);
	const opensWithTitle =
		tokens[0]?.type === "heading_open" && tokens[0].tag === "h1";
	return md.renderer.render(
		opensWithTitle ? tokens.slice(3) : tokens,
		md.options,
		env,
	);
}

/** Renders a Markdown string as a single inline fragment, with no wrapping `<p>`. */
export function renderMarkdownInline(text: string): string {
	return md.renderInline(text);
}
