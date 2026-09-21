import { createMemo, type JSX, Show } from "solid-js";
import { renderMarkdown, renderMarkdownInline } from "@/utils/markdown";

interface MarkdownProps {
	text: string | undefined;
	/** Render as a single inline fragment (no wrapping `<p>`), for choice text. */
	inline?: boolean;
}

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
		return props.inline ? renderMarkdownInline(text) : renderMarkdown(text);
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
