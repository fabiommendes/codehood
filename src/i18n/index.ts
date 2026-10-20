/// Translated messages and the locale of this installation, fixed at build time.

import type { z } from "zod";
import enLocale from "zod/v4/locales/en.js";
import ptLocale from "zod/v4/locales/pt.js";
import { getLocale, type Locale } from "@/generated/paraglide/runtime.js";

export { m } from "@/generated/paraglide/messages.js";
export type { Locale };

/// The locale this installation was built for.
export const locale: Locale = getLocale();

/// zod's own messages for each locale, for the issues the project does not word itself.
export const zodLocales: Record<Locale, () => Partial<z.core.$ZodConfig>> = {
	en: enLocale,
	"pt-BR": ptLocale,
};

/**
 * `text` escaped for HTML, for the parameters of a message rendered with `set:html`.
 *
 * The message text itself comes from the catalogue and is trusted; every value
 * passed into it must go through this function or be markup built from it.
 */
export function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/// Placeholder value that marks where markup goes inside a message, for {@link splitAtSlot}.
export const SLOT = "\u0000";

/**
 * The text of a message before and after its {@link SLOT}, for markup rendered in between.
 *
 * @example
 * const [before, after] = splitAtSlot(m.admin_users_created({ username: SLOT }));
 */
export function splitAtSlot(text: string): [before: string, after: string] {
	const at = text.indexOf(SLOT);
	return at < 0
		? [text, ""]
		: [text.slice(0, at), text.slice(at + SLOT.length)];
}
