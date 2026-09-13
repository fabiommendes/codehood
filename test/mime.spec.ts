import { expect, test } from "@playwright/test";
import fc from "fast-check";
import { formatBytes, parseByteSize } from "@/utils/format-bytes";
import { extensionOf, mimeFor } from "@/utils/mime";

test("extensionOf: named cases", () => {
	const cases: Array<[string, string | null]> = [
		["a.PDF", ".pdf"],
		["notes.txt", ".txt"],
		["archive.tar.gz", ".gz"], // only the last dot counts
		["noext", null], // no dot at all
		["trailing.", null], // trailing dot, nothing after
		[".", null], // leading dot, nothing after
	];

	for (const [filename, expected] of cases) {
		expect(extensionOf(filename), filename).toBe(expected);
	}
});

test("mimeFor: a known extension wins outright, discarding any declared type", () => {
	expect(mimeFor("notes.txt", "application/pdf")).toBe("text/plain");
});

test("mimeFor: an unknown or absent extension keeps the declared type", () => {
	expect(mimeFor("part.dwg", "application/acad")).toBe("application/acad");
	expect(mimeFor("noext", "text/plain")).toBe("text/plain");
});

test("mimeFor: neither a known extension nor a declared type gives application/octet-stream", () => {
	expect(mimeFor("noext", null)).toBe("application/octet-stream");
	expect(mimeFor("noext", undefined)).toBe("application/octet-stream");
	expect(mimeFor("part.dwg", null)).toBe("application/octet-stream");
});

test("mimeFor: .md and .mdq both derive text/markdown", () => {
	expect(mimeFor("handout.md")).toBe("text/markdown");
	expect(mimeFor("handout.mdq")).toBe("text/markdown");
});

test("parseByteSize: named cases", () => {
	const cases: Array<[string, number]> = [
		["200mb", 200 * 1024 * 1024],
		["200MB", 200 * 1024 * 1024],
		["200 mb", 200 * 1024 * 1024],
		["209715200", 200 * 1024 * 1024],
		["1b", 1],
		["1kb", 1024],
		["1gb", 1024 * 1024 * 1024],
		["0", 0],
	];

	for (const [input, expected] of cases) {
		expect(parseByteSize(input), input).toBe(expected);
	}
});

test("parseByteSize: throws on garbage, negatives and unknown suffixes", () => {
	for (const input of ["", "not-a-size", "12xb", "-5", "-5mb", "5 tb"]) {
		expect(() => parseByteSize(input), input).toThrow();
	}
});

test("parseByteSize is the inverse of formatBytes, within one rounding step", () => {
	fc.assert(
		fc.property(fc.integer({ min: 0, max: 5 * 1024 ** 3 }), (n) => {
			const formatted = formatBytes(n);
			const [, suffix] = formatted.split(" ");
			const multiplier =
				{ B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[
					suffix as "B" | "KB" | "MB" | "GB"
				] ?? 1;
			// formatBytes keeps one decimal digit for anything above bytes, so
			// the round trip can be off by at most half of that digit's weight.
			const tolerance = suffix === "B" ? 0 : multiplier / 20;
			const parsed = parseByteSize(formatted);
			expect(Math.abs(parsed - n)).toBeLessThanOrEqual(tolerance + 1);
		}),
		{ numRuns: 200 },
	);
});
