import { expect, test } from "@playwright/test";
import { filterRows, foldSearch } from "@/components/ui/search";

const people = [
	{ name: "João Silva", email: "joao@codehood.test" },
	{ name: "Ana Souza", email: "ana@codehood.test" },
	{ name: "Bruno Silva", email: "bruno@codehood.test" },
];
const text = (p: (typeof people)[number]) => `${p.name} ${p.email}`;

test.describe("filterRows", () => {
	test("a blank query keeps every row", () => {
		expect(filterRows(people, "  ", text)).toEqual(people);
	});

	test("matches any field, ignoring case and accents", () => {
		expect(filterRows(people, "JOAO", text).map((p) => p.name)).toEqual([
			"João Silva",
		]);
		expect(filterRows(people, "ana@", text).map((p) => p.name)).toEqual([
			"Ana Souza",
		]);
	});

	test("every word of the query must match, in any order", () => {
		expect(filterRows(people, "silva", text)).toHaveLength(2);
		expect(filterRows(people, "silva bruno", text).map((p) => p.name)).toEqual([
			"Bruno Silva",
		]);
		expect(filterRows(people, "silva ana", text)).toEqual([]);
	});
});

test("foldSearch drops marks and case", () => {
	expect(foldSearch("Conceição")).toBe("conceicao");
});
