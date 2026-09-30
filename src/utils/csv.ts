/// One cell of a CSV file, before quoting.
export type CsvValue = string | number;

/**
 * Writes one value as a CSV cell, quoted only when it has to be.
 *
 * @example
 * csvCell('Ada "the first"'); // '"Ada ""the first"""'
 */
export function csvCell(value: CsvValue): string {
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Writes rows as the text of a CSV file, with lines ending in CRLF.
 *
 * @example
 * toCsv([["name", "score"], ["Ada", 90]]); // "name,score\r\nAda,90"
 */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
	return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
