import MarkdownIt from "markdown-it";

/// The project's only MarkdownIt instance.
///
/// `html: false` is spelled out rather than left to the library's default:
/// every Markdown source here (question files, exam preambles, event
/// descriptions, resource notes) is authored by an instructor and rendered
/// into the app's own origin, so raw HTML in one of them would execute with
/// every reader's session. A default is not a guarantee across a major bump.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/** Renders a Markdown string as a block of sanitized HTML. */
export function renderMarkdown(text: string): string {
	return md.render(text);
}

/** Renders a Markdown string as a single inline fragment, with no wrapping `<p>`. */
export function renderMarkdownInline(text: string): string {
	return md.renderInline(text);
}
