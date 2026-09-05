import MarkdownIt from "markdown-it";
import { createMemo, type JSX, Show } from "solid-js";

interface MarkdownProps {
	text: string | undefined;
	/** Render as a single inline fragment (no wrapping `<p>`), for choice text. */
	inline?: boolean;
}

// Raw HTML stays off for the same reason it is off for resource notes
// (`dev/specs/to-review/resources.md`): this text comes from an instructor's
// question file, and the app's origin is not a boundary worth trusting it
// with.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

/**
 * Renders a Markdown string as sanitized HTML, block or inline.
 *
 * Renders nothing when `text` is empty or absent, so callers can pass an
 * optional field (`preamble`, `epilogue`) without guarding it themselves.
 */
export default function Markdown(props: MarkdownProps): JSX.Element {
	const html = createMemo(() => {
		const text = props.text;
		if (!text) return undefined;
		return props.inline ? md.renderInline(text) : md.render(text);
	});

	return (
		<Show when={html()}>
			{(rendered) =>
				props.inline ? (
					<span innerHTML={rendered()} />
				) : (
					<div class="prose prose-sm max-w-none" innerHTML={rendered()} />
				)
			}
		</Show>
	);
}
