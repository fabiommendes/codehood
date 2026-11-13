/**
 * Markdown rendering shared by every page, and the HTML policy of the
 * authored text.
 *
 * Authors may write HTML comments, which vanish from the result, and a few
 * tags. Everything the renderer produces goes through the sanitizer of this
 * module, a parser based one (`sanitize-html`), before it leaves it. Nothing
 * outside the policy below is published:
 *
 * - Tags of documents: `a`, `blockquote`, `br`, `code`, `del`, `details`,
 *   `div`, `em`, `h1` to `h6`, `hr`, `img`, `kbd`, `li`, `mark`, `ol`, `p`,
 *   `pre`, `s`, `strong`, `sub`, `summary`, `sup`, `table`, `tbody`, `td`,
 *   `th`, `thead`, `tr`, `ul`.
 * - Tags of inline fragments: the same without the blocks (`blockquote`,
 *   `details`, `div`, headings, `hr`, lists, `p`, `pre`, `summary`, tables).
 * - Attributes: `href` and `title` on `a`; `src`, `alt` and `title` on `img`;
 *   `open` on `details`; `start` on `ol`; `text-align` (left, right, center)
 *   as the only `style` of `td` and `th`; the `language-*` class of `code`.
 * - URLs: `http`, `https`, `mailto` and relative ones. Entities, mixed case
 *   and control characters are resolved by the parser before the check.
 * - Anything else (scripts, `on*` handlers, `style`, forms, frames, SVG,
 *   MathML) is discarded together with its content.
 *
 * Order of the transformations:
 *
 * 1. MarkdownIt renders the text with `html: true`. The runner blocks it
 *    generates carry a `class` and a `data-language` that the policy does not
 *    let an author write, so they are spelled with a random per render
 *    `nonce` inside their names (`class="<nonce>code-runner-block"`,
 *    `data-<nonce>language`).
 * 2. The sanitizer runs over the whole result. It keeps only the nonce
 *    spelled names, and the author cannot know the nonce.
 * 3. The nonce is deleted from the output, and the markers have their real
 *    names back.
 */
import { randomBytes } from "node:crypto";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { m } from "@/i18n";
import { runnerLanguage } from "@/runner/languages";
import { highlightCode } from "./highlight-code";

/// The project's only MarkdownIt instance.
///
/// `html: true` lets authors write comments and the tags of the policy, and
/// is only safe because every render goes through `sanitize`.
const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

/// Wrapper class of a ```js run block whose language has a driver. Same
/// value as `CODE_RUNNER_BLOCK_CLASS` of `mount-blocks.ts`, which cannot be
/// imported here because it pulls in the widget.
const RUNNER_BLOCK_CLASS = "code-runner-block";

/// Wrapper class of a `run` block whose language has no driver.
const RUNNER_UNAVAILABLE_CLASS = "code-runner-unavailable";

/// What `md` receives as environment: the secret of the current render.
type RenderEnv = { nonce?: string };

function nonceOf(env: unknown): string {
	const nonce = (env as RenderEnv | undefined)?.nonce;
	if (!nonce) throw new Error("markdown rendered without a nonce");
	return nonce;
}

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
	const nonce = nonceOf(env);
	const pre = `<pre><code>${md.utils.escapeHtml(token.content)}</code></pre>`;
	const language = runnerLanguage(tag);
	if (language === null) {
		return `<div class="${nonce}${RUNNER_UNAVAILABLE_CLASS}">${pre}<p class="${nonce}text-xs ${nonce}text-muted">${md.utils.escapeHtml(m.runner_block_unavailable())}</p></div>\n`;
	}
	return `<div class="${nonce}${RUNNER_BLOCK_CLASS}" data-${nonce}language="${language}">${pre}</div>\n`;
};

/// Tags of inline fragments: no block may appear where a line of text does.
const INLINE_TAGS = [
	"a",
	"br",
	"code",
	"del",
	"em",
	"img",
	"kbd",
	"mark",
	"s",
	"strong",
	"sub",
	"sup",
];

/// Tags of documents: the inline ones, what Markdown generates for blocks,
/// and `details`/`summary` for the author.
const BLOCK_TAGS = [
	...INLINE_TAGS,
	"blockquote",
	"details",
	"div",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"li",
	"ol",
	"p",
	"pre",
	"summary",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"ul",
];

/// Sanitizer options of one render. The nonce spelled names are the only
/// `class` and `data-*` that pass.
function policy(nonce: string, inline: boolean): sanitizeHtml.IOptions {
	const align = { "text-align": [/^(left|right|center)$/] };
	return {
		allowedTags: inline ? INLINE_TAGS : BLOCK_TAGS,
		allowedAttributes: {
			a: ["href", "title"],
			img: ["src", "alt", "title"],
			details: ["open"],
			ol: ["start"],
			th: ["style"],
			td: ["style"],
			code: ["class"],
			div: ["class", `data-${nonce}language`],
			p: ["class"],
		},
		allowedClasses: {
			code: ["language-*"],
			div: [
				`${nonce}${RUNNER_BLOCK_CLASS}`,
				`${nonce}${RUNNER_UNAVAILABLE_CLASS}`,
			],
			p: [`${nonce}text-xs`, `${nonce}text-muted`],
		},
		allowedStyles: { th: align, td: align },
		allowedSchemes: ["http", "https", "mailto"],
		allowedSchemesAppliedToAttributes: ["href", "src"],
		allowProtocolRelative: false,
		disallowedTagsMode: "discard",
	};
}

/// Sanitizes what `md` rendered, then gives the application's markers their
/// real names back.
function sanitize(html: string, nonce: string, inline: boolean): string {
	return sanitizeHtml(html, policy(nonce, inline)).replaceAll(nonce, "");
}

/// A fresh secret per render, starting with a letter so that it is a valid
/// beginning for an attribute name.
function newNonce(): string {
	return `n${randomBytes(12).toString("hex")}`;
}

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
	const nonce = newNonce();
	return sanitize(md.render(text, { nonce }), nonce, false);
}

/**
 * Renders a Markdown document whose title the page already shows, dropping
 * a level-one heading that opens it.
 */
export function renderMarkdownBody(text: string): string {
	const nonce = newNonce();
	const env: RenderEnv = { nonce };
	const tokens = md.parse(text, env);
	const opensWithTitle =
		tokens[0]?.type === "heading_open" && tokens[0].tag === "h1";
	const html = md.renderer.render(
		opensWithTitle ? tokens.slice(3) : tokens,
		md.options,
		env,
	);
	return sanitize(html, nonce, false);
}

/** Renders a Markdown string as a single inline fragment, with no wrapping `<p>`. */
export function renderMarkdownInline(text: string): string {
	const nonce = newNonce();
	return sanitize(md.renderInline(text, { nonce }), nonce, true);
}
