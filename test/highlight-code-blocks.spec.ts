import { expect, test } from "@playwright/test";
import { codeBlockKey } from "@/utils/code-blocks";
import { highlightQuestionCodeBlocks } from "@/utils/highlight-code-blocks";
import { highlightCodeBlocks, renderMarkdown } from "@/utils/markdown";

const PYTHON = "def f(n):\n    return n\n";

test("highlights the fenced blocks of every text of a question, keyed by code and language", async () => {
	const blocks = await highlightQuestionCodeBlocks({
		type: "multiple-choice",
		stem: `Read:\n\n\`\`\`python title\n${PYTHON}\`\`\``,
		choices: [{ id: "a", text: "x", feedback: "~~~\nplain\n~~~" }],
	});
	expect(Object.keys(blocks).sort()).toEqual(
		[codeBlockKey(PYTHON, "python"), codeBlockKey("plain\n", "")].sort(),
	);
	const html = blocks[codeBlockKey(PYTHON, "python")] ?? "";
	expect(html).toMatch(/^<pre class="shiki/);
	expect(html).toContain("--shiki-light:");
	expect(html).toContain("--shiki-dark:");
	// The fence's closing newline is not an empty last line.
	expect(html.match(/class="line"/g)).toHaveLength(2);
});

test("a question without fenced blocks has none", async () => {
	expect(
		await highlightQuestionCodeBlocks({ stem: "Inline `code` only." }),
	).toEqual({});
});

test("highlights the code blocks of rendered Markdown and leaves the rest", async () => {
	const html = await highlightCodeBlocks(
		renderMarkdown(
			`Intro \`x\`\n\n\`\`\`python\n${PYTHON}\`\`\`\n\n    indented`,
		),
	);
	expect(html).toContain("<p>Intro <code>x</code></p>");
	expect(html.match(/<pre class="shiki/g)).toHaveLength(2);
	expect(html).not.toContain("language-python");
	expect(html).toContain("return");
});

test("leaves the code of runner blocks to the runner", async () => {
	const rendered = renderMarkdown("```js run\n1 + 1\n```");
	expect(await highlightCodeBlocks(rendered)).toBe(rendered);
});
