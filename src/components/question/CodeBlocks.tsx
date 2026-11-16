import { CodeBlockProvider } from "mdq/solid";
import type { JSX, ParentProps } from "solid-js";
import { type CodeBlocksHtml, codeBlockKey } from "@/utils/code-blocks";

export interface CodeBlocksProps extends ParentProps {
	/// The highlighted fenced blocks, from `highlightQuestionCodeBlocks`. Trusted: never user HTML.
	html?: CodeBlocksHtml;
}

/**
 * Draws the fenced code blocks of the `mdq/solid` Markdown inside it with the
 * HTML the server highlighted, and a block it lacks as the plain `<pre>`.
 */
export function CodeBlocks(props: CodeBlocksProps): JSX.Element {
	return (
		<CodeBlockProvider
			render={(code, lang) => props.html?.[codeBlockKey(code, lang)]}
		>
			{props.children}
		</CodeBlockProvider>
	);
}
