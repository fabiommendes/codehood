import { expect, test } from "@playwright/test";
import { renderMarkdownBody } from "@/utils/markdown";

test("a note's opening level-one heading is dropped, the page already shows its title", () => {
	const html = renderMarkdownBody("# Recursion\n\nA base case.");
	expect(html).not.toContain("<h1");
	expect(html).toContain("<p>A base case.</p>");
});

test("a heading that does not open the note, or is not level one, stays", () => {
	expect(renderMarkdownBody("Intro.\n\n# Later")).toContain("<h1>Later</h1>");
	expect(renderMarkdownBody("## Part one\n\nText.")).toContain(
		"<h2>Part one</h2>",
	);
});
