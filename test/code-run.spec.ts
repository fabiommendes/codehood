import { expect, test } from "@playwright/test";
import { canRunCode, effectiveCodeRun } from "@/services/code-run";

const TYPES = ["PRACTICE", "QUIZ", "EXAM"] as const;
const FLAGS = [null, true, false] as const;

for (const type of TYPES) {
	for (const allowCodeRun of FLAGS) {
		test(`${type} with allowCodeRun ${allowCodeRun} resolves as documented`, () => {
			const expected =
				allowCodeRun === null
					? { allowed: type === "PRACTICE", source: "default" }
					: { allowed: allowCodeRun, source: "exam" };
			expect(effectiveCodeRun({ type, allowCodeRun })).toEqual(expected);
			expect(canRunCode({ type, allowCodeRun })).toBe(expected.allowed);
		});
	}
}
