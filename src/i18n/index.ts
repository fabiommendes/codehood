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
