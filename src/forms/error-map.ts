import { z } from "zod";

type Issue = Parameters<
	NonNullable<ReturnType<typeof z.config>["customError"]>
>[0];

/// Message for the empty-value and format issues zod words poorly for a form.
/// Anything else returns undefined and keeps zod's default (English) text.
function customError(issue: Issue): string | undefined {
	if (issue.code === "invalid_type" || issue.code === "invalid_value") {
		return issue.input === null || issue.input === undefined
			? "Required"
			: undefined;
	}
	if (issue.code === "too_small" && issue.origin === "string") {
		return issue.minimum === 1 || issue.minimum === 1n
			? "Required"
			: `Must be at least ${issue.minimum} characters`;
	}
	if (issue.code === "too_big" && issue.origin === "string") {
		return `Must be at most ${issue.maximum} characters`;
	}
	if (issue.code === "invalid_format") {
		if (issue.format === "email") return "Enter a valid email address";
		if (issue.format === "url") return "Enter a valid URL";
	}
	return undefined;
}

/**
 * Installs the project's zod error map globally, once.
 *
 * Safe to call from every module that needs it, on the server and in the
 * client bundle. Messages are in English, the language of the UI.
 */
export function installErrorMap(): void {
	if (z.config().customError === customError) return;
	z.config({ customError });
}
