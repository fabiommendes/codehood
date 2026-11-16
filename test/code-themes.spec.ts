import { expect, test } from "@playwright/test";
import { CODE_THEME_CSS, CODE_THEMES } from "@/utils/code-themes";

/// The `--code-*` properties of one rule of `CODE_THEME_CSS`.
function variables(selector: string): Record<string, string> {
	const start = CODE_THEME_CSS.indexOf(`${selector}{`);
	expect(start).toBeGreaterThanOrEqual(0);
	const body = CODE_THEME_CSS.slice(
		start + selector.length + 1,
		CODE_THEME_CSS.indexOf("}", start),
	);
	return Object.fromEntries(
		body.split(";").map((entry) => entry.split(":") as [string, string]),
	);
}

test("the editor chrome of each site theme has the background and text of its code theme", () => {
	for (const [selector, theme] of [
		[":root", CODE_THEMES.light],
		['[data-theme="codehood-dark"]', CODE_THEMES.dark],
	] as const) {
		const vars = variables(selector);
		expect(vars["--code-bg"]).toBe(theme.colors?.["editor.background"]);
		expect(vars["--code-fg"]).toBe(theme.colors?.["editor.foreground"]);
		for (const name of [
			"--code-muted",
			"--code-panel",
			"--code-border",
			"--code-selection",
			"--code-active-line",
		]) {
			expect(vars[name]).toMatch(/^#[0-9a-f]{6,8}$/);
		}
	}
});
