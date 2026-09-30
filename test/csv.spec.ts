import { expect, test } from "@playwright/test";
import { csvCell, toCsv } from "@/utils/csv";

test("csvCell: plain text and numbers go unquoted", () => {
	expect(csvCell("Ada Lovelace")).toBe("Ada Lovelace");
	expect(csvCell(87.5)).toBe("87.5");
	expect(csvCell("")).toBe("");
});

test("csvCell: a comma, a quote or a line break quotes the cell", () => {
	expect(csvCell("Lovelace, Ada")).toBe('"Lovelace, Ada"');
	expect(csvCell('Ada "the first"')).toBe('"Ada ""the first"""');
	expect(csvCell("two\nlines")).toBe('"two\nlines"');
	expect(csvCell("two\r\nlines")).toBe('"two\r\nlines"');
});

test("toCsv: rows end in CRLF, with none after the last", () => {
	expect(
		toCsv([
			["name", "score"],
			["Ada", 90],
		]),
	).toBe("name,score\r\nAda,90");
});
