import { expect, test } from "@playwright/test";
import {
	renderMarkdown,
	renderMarkdownBody,
	renderMarkdownInline,
} from "@/utils/markdown";

/// Attacks that must never survive as a live element or attribute.
const FORBIDDEN = [
	/<script/i,
	/<iframe/i,
	/<form/i,
	/<input/i,
	/<svg/i,
	/<math/i,
	/<object/i,
	/<embed/i,
	/<style/i,
	/\son\w+\s*=/i,
	/javascript:/i,
];

function expectInert(html: string) {
	for (const pattern of FORBIDDEN) expect(html).not.toMatch(pattern);
}

test.describe("comments", () => {
	test("a multi-line comment with headings, lists and links vanishes whole", () => {
		const html = renderMarkdown(
			"Texto público.\n\n<!--\n## Exercícios em revisão\n\n* [Questão](questions/exemplo.md)\n-->\n\nMais texto público.\n",
		);
		expect(html).toContain("<p>Texto público.</p>");
		expect(html).toContain("<p>Mais texto público.</p>");
		expect(html).not.toContain("Exercícios");
		expect(html).not.toContain("exemplo.md");
		expect(html).not.toContain("--");
		expect(html).not.toContain("&lt;!");
	});

	test("an inline comment hides only its own text", () => {
		const html = renderMarkdown("antes <!-- oculto --> depois");
		expect(html).toContain("antes");
		expect(html).toContain("depois");
		expect(html).not.toContain("oculto");
		expect(renderMarkdownInline("a <!-- x --> b")).not.toContain("x -->");
		expect(renderMarkdownInline("a <!-- x --> b")).not.toContain("<!--");
	});

	test("two comments do not swallow the text between them", () => {
		const html = renderMarkdown("<!-- a -->\n\nvisível\n\n<!-- b -->\n");
		expect(html).toContain("<p>visível</p>");
		expect(html).not.toMatch(/>\s*[ab]\s*</);
	});

	test("comments in inline code and fenced code stay literal", () => {
		expect(renderMarkdown("use `<!-- nota -->` assim")).toContain(
			"<code>&lt;!-- nota --&gt;</code>",
		);
		const fenced = renderMarkdown("```html\n<!-- nota -->\n<b>x</b>\n```\n");
		expect(fenced).toContain("&lt;!-- nota --&gt;");
		expect(fenced).toContain("&lt;b&gt;x&lt;/b&gt;");
		expect(fenced).not.toContain("<b>");
	});

	test("the note body renderer drops comments too", () => {
		const html = renderMarkdownBody("# Título\n\n<!-- x -->\n\ntexto");
		expect(html).not.toContain("x -->");
		expect(html).not.toContain("<h1");
		expect(html).toContain("<p>texto</p>");
	});
});

test.describe("allowed tags", () => {
	test("details with open, summary, kbd, sup, sub, mark and br work", () => {
		const html = renderMarkdown(
			"<details open>\n<summary>Ver</summary>\n\nCorpo *em*.\n\n</details>\n\nUse <kbd>Ctrl</kbd> + <kbd>D</kbd>, O(n<sup>2</sup>), H<sub>2</sub>O, <mark>x</mark>.<br>fim",
		);
		expect(html).toMatch(/<details open(="")?>/);
		expect(html).toContain("<summary>Ver</summary>");
		expect(html).toContain("<em>em</em>");
		expect(html).toContain("<kbd>Ctrl</kbd>");
		expect(html).toContain("<sup>2</sup>");
		expect(html).toContain("<sub>2</sub>");
		expect(html).toContain("<mark>x</mark>");
		expect(html).toMatch(/<br ?\/?>fim/);
	});

	test("details without open stays closed and other attributes are dropped", () => {
		const html = renderMarkdown(
			'<details class="x" id="y" style="color:red" data-a="b"><summary>S</summary>\n\ncorpo\n\n</details>',
		);
		expect(html).toMatch(/<details>/);
		expect(html).not.toMatch(/class=|id=|style=|data-a/);
	});

	test("inline rendering keeps inline tags but not block ones", () => {
		const html = renderMarkdownInline(
			"<kbd>Ctrl</kbd> <sup>2</sup> <mark>m</mark> <details><summary>S</summary>dentro</details> <div>d</div> <p>p</p>",
		);
		expect(html).toContain("<kbd>Ctrl</kbd>");
		expect(html).toContain("<sup>2</sup>");
		expect(html).toContain("<mark>m</mark>");
		expect(html).not.toMatch(/<(details|summary|div|p)[ >]/);
	});
});

test.describe("hostile html", () => {
	test("scripts, handlers, style, iframe, form, svg and mathml are neutralised", () => {
		const payload = [
			"<script>alert(1)</script>",
			'<img src=x onerror="alert(1)">',
			'<p onclick="alert(1)" style="x:y">p</p>',
			'<iframe src="https://evil"></iframe>',
			'<form action="/x"><input name=a><button>b</button></form>',
			"<svg onload=alert(1)><circle/></svg>",
			"<math><mi xlink:href=javascript:alert(1)>x</mi></math>",
			"<style>*{display:none}</style>",
			'<object data="x"></object><embed src="x">',
		].join("\n\n");
		expectInert(renderMarkdown(payload));
		expectInert(renderMarkdownInline(payload.replaceAll("\n\n", " ")));
		expectInert(renderMarkdownBody(payload));
	});

	test("script content is discarded, not shown as text", () => {
		expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("alert");
	});

	test("javascript urls are removed from markdown and html links", () => {
		const cases = [
			"[x](javascript:alert(1))",
			'<a href="javascript:alert(1)">x</a>',
			'<a href="JaVaScRiPt:alert(1)">x</a>',
			'<a href="&#106;avascript:alert(1)">x</a>',
			'<a href="&#x6A;&#x61;vascript&colon;alert(1)">x</a>',
			'<a href="jav&#x09;ascript:alert(1)">x</a>',
			'<a href="\u0001javascript:alert(1)">x</a>',
			'<a href=" \njavascript:alert(1)">x</a>',
			'<a href="vbscript:x">x</a>',
			'<a href="data:text/html,<script>alert(1)</script>">x</a>',
			'<img src="javascript:alert(1)">',
		];
		for (const source of cases) {
			const html = renderMarkdown(source);
			expect(html, source).not.toMatch(/href\s*=\s*"[^"]*(script|data:)/i);
			expect(html, source).not.toMatch(/src\s*=\s*"[^"]*script/i);
			expect(html, source).not.toMatch(/<a [^>]*alert/);
		}
	});

	test("http, https, mailto and relative urls survive", () => {
		const html = renderMarkdown(
			'<a href="https://a.com/x?y=1&amp;z=2">a</a> <a href="http://b.com">b</a> <a href="mailto:a@b.com">c</a> <a href="docs/x.md#s">d</a> <a href="/abs">e</a>',
		);
		expect(html).toContain('href="https://a.com/x?y=1&amp;z=2"');
		expect(html).toContain('href="http://b.com"');
		expect(html).toContain('href="mailto:a@b.com"');
		expect(html).toContain('href="docs/x.md#s"');
		expect(html).toContain('href="/abs"');
	});

	test("malformed html cannot break out or leave live markup", () => {
		const cases = [
			"<scr<script>ipt>alert(1)</scr</script>ipt>",
			'<a href="x" onclick=alert(1)//>x</a>',
			'<img src="x"onerror="alert(1)">',
			"<<script>alert(1)//<</script>",
			'<div><p>aberto <b onmouseover="alert(1)">x',
			'<a href="x"><svg/onload=alert(1)>',
			"<!--><script>alert(1)</script>-->",
			"<!-- a --!><script>alert(1)</script>",
			"<details><summary>aberto",
		];
		for (const source of cases) {
			expectInert(renderMarkdown(source));
			expectInert(renderMarkdownInline(source));
		}
	});
});

test.describe("runner markers", () => {
	test("author class and data-language do not become a runner block", () => {
		const html = renderMarkdown(
			'<div class="code-runner-block" data-language="javascript"><pre><code>alert(1)</code></pre></div>',
		);
		expect(html).not.toContain("code-runner-block");
		expect(html).not.toContain("data-language");
		expect(html).not.toContain("class=");
	});

	test("author classes, ids and data attributes are dropped everywhere", () => {
		const html = renderMarkdown(
			'<p class="code-runner-unavailable" id="a" data-language="x">p</p>\n\n<kbd class="c" data-x="1">k</kbd>\n\n<code class="code-runner-block">c</code>',
		);
		expect(html).not.toMatch(/class=|id=|data-/);
	});

	test("a forged block does not survive highlightRunnerBlocks's pattern", () => {
		const html = renderMarkdown(
			'<div class="code-runner-block" data-language="javascript"><pre><code>x</code></pre></div>',
		);
		expect(html).not.toMatch(
			/<div class="code-runner-block" data-language="[a-z]+"><pre><code>/,
		);
	});

	test("the app's own run blocks still render with their markers", () => {
		const html = renderMarkdown("```js run\nconsole.log(1)\n```\n");
		expect(html).toContain(
			'<div class="code-runner-block" data-language="javascript"><pre><code>console.log(1)\n</code></pre></div>',
		);
	});

	test("a run block with no driver keeps its note and classes", () => {
		const html = renderMarkdown("```haskell run\nmain = pure ()\n```\n");
		expect(html).toContain('<div class="code-runner-unavailable">');
		expect(html).toContain('<p class="text-xs text-muted">');
	});

	test("a forged block next to a real one leaves only the real one", () => {
		const html = renderMarkdown(
			'<div class="code-runner-block" data-language="python"></div>\n\n```js run\n1\n```\n',
		);
		expect(html.match(/code-runner-block/g)).toHaveLength(1);
		expect(html).not.toContain('data-language="python"');
	});

	test("a nonce cannot be guessed from one render to the next", () => {
		const source = "```js run\n1\n```\n";
		expect(renderMarkdown(source)).toBe(renderMarkdown(source));
	});
});

test.describe("existing markdown", () => {
	test("links, tables with alignment, lists and code are unchanged", () => {
		const html = renderMarkdown(
			'[a](https://x.com "t") e https://auto.com\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n1. um\n2. dois\n\n- x\n\n> citação\n\n```js\nlet a = 1 < 2;\n```\n\n![alt](img.png)\n\n---\n\n**b** *i* ~~s~~',
		);
		expect(html).toContain('<a href="https://x.com" title="t">a</a>');
		expect(html).toContain('<a href="https://auto.com">https://auto.com</a>');
		expect(html).toContain("<table>");
		expect(html).toMatch(/<th style="text-align:left">a<\/th>/);
		expect(html).toMatch(/<td style="text-align:right">2<\/td>/);
		expect(html).toContain("<ol>");
		expect(html).toContain("<blockquote>");
		expect(html).toContain('<code class="language-js">let a = 1 &lt; 2;');
		expect(html).toMatch(/<img src="img.png" alt="alt" ?\/?>/);
		expect(html).toMatch(/<hr ?\/?>/);
		expect(html).toContain("<strong>b</strong>");
		expect(html).toContain("<s>s</s>");
	});

	test("only text-align survives in a style attribute", () => {
		const html = renderMarkdown(
			'<table><tr><th style="text-align:center;background:url(javascript:x)">a</th></tr></table>',
		);
		expect(html).not.toContain("background");
		expect(html).not.toContain("javascript");
	});

	test("inline markdown keeps no wrapping paragraph", () => {
		expect(renderMarkdownInline("**a** `b`")).toBe(
			"<strong>a</strong> <code>b</code>",
		);
	});
});
