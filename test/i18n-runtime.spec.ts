import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { locale, zodLocales } from "@/i18n";

const settings = JSON.parse(
	fs.readFileSync("project.inlang/settings.json", "utf8"),
) as { locales: string[] };

test.describe("AC9 runtime", () => {
	test.afterEach(() => {
		z.config(zodLocales.en());
	});

	test("the locale is the base locale when the build does not define one", () => {
		expect(locale).toBe("en");
	});

	test("zodLocales has an entry for every configured locale", () => {
		expect(Object.keys(zodLocales).sort()).toEqual(
			[...settings.locales].sort(),
		);
		for (const factory of Object.values(zodLocales)) {
			expect(typeof factory().localeError).toBe("function");
		}
	});

	test("zod issues are worded in the selected locale", () => {
		z.config(zodLocales.en());
		const english = z.string().safeParse(1).error?.issues[0]?.message;
		z.config(zodLocales["pt-BR"]());
		const portuguese = z.string().safeParse(1).error?.issues[0]?.message;

		expect(english).toBeTruthy();
		expect(portuguese).toBeTruthy();
		expect(portuguese).not.toBe(english);
	});
});
