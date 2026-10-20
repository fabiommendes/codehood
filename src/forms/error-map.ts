import { z } from "zod";
import { locale, m, zodLocales } from "@/i18n";

type Issue = Parameters<
	NonNullable<ReturnType<typeof z.config>["customError"]>
>[0];

/// Message for the empty-value and format issues zod words poorly for a form.
/// Anything else returns undefined and keeps the zod locale's text.
function customError(issue: Issue): string | undefined {
	if (issue.code === "invalid_type" || issue.code === "invalid_value") {
		return issue.input === null || issue.input === undefined
			? m.forms_error_required()
			: undefined;
	}
	if (issue.code === "too_small" && issue.origin === "string") {
		return issue.minimum === 1 || issue.minimum === 1n
			? m.forms_error_required()
			: m.forms_error_min_length({ min: String(issue.minimum) });
	}
	if (issue.code === "too_big" && issue.origin === "string") {
		return m.forms_error_max_length({ max: String(issue.maximum) });
	}
	if (issue.code === "invalid_format") {
		if (issue.format === "email") return m.forms_error_email();
		if (issue.format === "url") return m.forms_error_url();
	}
	return undefined;
}

/**
 * Installs the project's zod error map globally, once.
 *
 * Safe to call from every module that needs it, on the server and in the
 * client bundle. Issues the project does not reword use the zod locale of the
 * installation.
 */
export function installErrorMap(): void {
	if (z.config().customError === customError) return;
	z.config(zodLocales[locale]());
	z.config({ customError });
}
