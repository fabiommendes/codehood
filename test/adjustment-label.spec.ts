import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import type { AdjustmentOp } from "@/services/exam-result";

/// The locale is fixed when the message runtime loads, so the labels are read in a child process built for pt-BR, which leaves the locale of this worker alone.
function labelsInPortuguese(
	cases: ReadonlyArray<{ op: AdjustmentOp; value: number }>,
): string[] {
	const script = `
		globalThis.__CODEHOOD_LOCALE__ = "pt-BR";
		(async () => {
			const { adjustmentLabel } = await import("@/utils/adjustment-label");
			const cases = ${JSON.stringify(cases)};
			console.log(JSON.stringify(cases.map((entry) => adjustmentLabel(entry))));
		})().catch((error) => {
			console.error(error);
			process.exit(1);
		});
	`;
	const output = execFileSync("pnpm", ["exec", "tsx", "-e", script], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	const lastLine = output.trim().split("\n").at(-1) ?? "[]";
	return JSON.parse(lastLine) as string[];
}

const cases: Array<{
	name: string;
	op: AdjustmentOp;
	value: number;
	label: string;
}> = [
	{
		name: "SET shows the percent",
		op: "SET",
		value: 0.8,
		label: "Nota substituída por 80%",
	},
	{
		name: "SET 0 shows 0%",
		op: "SET",
		value: 0,
		label: "Nota substituída por 0%",
	},
	{
		name: "a FACTOR above 1 is a bonus factor",
		op: "FACTOR",
		value: 1.1,
		label: "Bônus ×1,1",
	},
	{
		name: "a positive OFFSET is a bonus in points",
		op: "OFFSET",
		value: 0.1,
		label: "Bônus +10",
	},
	{
		name: "a negative OFFSET is a penalty in points, with the minus sign U+2212",
		op: "OFFSET",
		value: -0.1,
		label: "Penalidade −10",
	},
	{
		name: "a FACTOR below 1 is a penalty factor",
		op: "FACTOR",
		value: 0.5,
		label: "Penalidade ×0,5",
	},
	{ name: "a FACTOR 0 is zeroed", op: "FACTOR", value: 0, label: "Zerada" },
	{
		name: "a FACTOR of 1.5 reads without trailing zeros",
		op: "FACTOR",
		value: 1.5,
		label: "Bônus ×1,5",
	},
	{
		name: "an OFFSET of 0.05 shows 5 points",
		op: "OFFSET",
		value: 0.05,
		label: "Bônus +5",
	},
];

let labels: string[] = [];

test.beforeAll(() => {
	labels = labelsInPortuguese(cases);
});

test.describe("adjustmentLabel in pt-BR", () => {
	cases.forEach(({ name, label }, index) => {
		test(name, () => {
			expect(labels[index]).toBe(label);
		});
	});
});
