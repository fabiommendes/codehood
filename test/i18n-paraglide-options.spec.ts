import path from "node:path";
import { expect, test } from "@playwright/test";
import { localeDefine, paraglideOptions } from "../scripts/lib/paraglide";

const ROOT = process.cwd();
const GLOBAL = "__CODEHOOD_LOCALE__";

test.describe("AC8 localeDefine", () => {
	test("without CODEHOOD_LOCALE defines the base locale as a JSON string", () => {
		expect(localeDefine(ROOT, {})).toEqual({ [GLOBAL]: '"en"' });
	});

	test("defines the requested locale as a JSON string", () => {
		expect(localeDefine(ROOT, { CODEHOOD_LOCALE: "pt-BR" })).toEqual({
			[GLOBAL]: '"pt-BR"',
		});
	});

	test("an unknown locale throws an error listing the available ones", () => {
		expect(() => localeDefine(ROOT, { CODEHOOD_LOCALE: "xx" })).toThrow(
			/xx[\s\S]*en[\s\S]*pt-BR/,
		);
	});
});

test.describe("AC8 paraglideOptions", () => {
	test("points at the project and the generated output under the root", () => {
		const options = paraglideOptions(ROOT);

		expect(options.project).toBe(path.join(ROOT, "project.inlang"));
		expect(options.outdir).toBe(path.join(ROOT, "src/generated/paraglide"));
	});

	test.describe("static locale expression", () => {
		const evaluate = () => {
			const expression = paraglideOptions(ROOT).experimentalStaticLocale;
			return new Function(`return ${expression}`)();
		};

		test.afterEach(() => {
			delete (globalThis as Record<string, unknown>)[GLOBAL];
		});

		test("falls back to the base locale where the global is not defined", () => {
			expect(evaluate()).toBe("en");
		});

		test("reads the global when it is defined", () => {
			(globalThis as Record<string, unknown>)[GLOBAL] = "pt-BR";

			expect(evaluate()).toBe("pt-BR");
		});
	});
});
