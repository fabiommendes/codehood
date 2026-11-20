import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { InvalidData } from "@/core/error";
import { assertResponse } from "@/mdq";
import { uploadFactory } from "@/mdq/factory";
import { uploadFilename } from "@/services/upload-filename";
import { sanitizeFilename } from "@/utils/filename";

function hasControl(text: string): boolean {
	return [...text].some((char) => {
		const code = char.charCodeAt(0);
		return (
			code < 0x20 ||
			(code >= 0x7f && code <= 0x9f) ||
			code === 0x2028 ||
			code === 0x2029
		);
	});
}

const restricted = uploadFactory.build({
	extensions: [".pdf", ".tar.gz", ".gz"],
	maxFiles: 5,
	maxSize: "5 MB",
});
const unrestricted = uploadFactory.build({
	extensions: undefined,
	maxFiles: 5,
	maxSize: "5 MB",
});

const accepted: ReadonlyArray<[string, string]> = [
	["x.tar.gz", "x.tar.gz"],
	["Relatório.PDF", "relatorio.pdf"],
	["ARQ.TAR.GZ", "arq.tar.gz"],
	["x.gz", "x.gz"],
];

function asResponse(name: string) {
	return [
		{
			name,
			path: createHash("sha256").update(name).digest("hex"),
			size: 1,
		},
	];
}

test("uploadFilename keeps the longest matching extension and lower-cases it", () => {
	for (const [raw, expected] of accepted) {
		expect(uploadFilename(raw, restricted)).toBe(expected);
	}
});

test("uploadFilename keeps a dotted stem in front of a compound extension", () => {
	expect(
		uploadFilename("my.report.tar.gz", restricted).endsWith(".tar.gz"),
	).toBe(true);
});

test("uploadFilename refuses a name whose extension the question does not list", () => {
	expect(() => uploadFilename("x.zip", restricted)).toThrow(InvalidData);
});

test("uploadFilename never fails with anything but InvalidData for a name that is only an extension", () => {
	let result: string;
	try {
		result = uploadFilename(".pdf", restricted);
	} catch (error) {
		expect(error).toBeInstanceOf(InvalidData);
		return;
	}
	expect(result.endsWith(".pdf")).toBe(true);
	expect(result.startsWith(".")).toBe(false);
	assertResponse(restricted, asResponse(result));
});

test("uploadFilename truncates a very long stem to 255 bytes and keeps the compound extension", () => {
	const result = uploadFilename(`${"a".repeat(300)}.tar.gz`, restricted);
	expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(255);
	expect(result.endsWith(".tar.gz")).toBe(true);
});

test("uploadFilename removes control characters and line breaks from the name", () => {
	const result = uploadFilename("a\nb.pdf", restricted);
	expect(hasControl(result)).toBe(false);
	expect(result.endsWith(".pdf")).toBe(true);
});

test("uploadFilename of a question without extensions is sanitizeFilename", () => {
	for (const name of ["Relatório Final.PDF", "a b.tar.gz", "README", "x.zip"]) {
		expect(uploadFilename(name, unrestricted)).toBe(sanitizeFilename(name));
	}
});

test("uploadFilename is idempotent and its result is a valid upload response, for every accepted name", () => {
	const names = [
		...accepted.map(([raw]) => raw),
		"my.report.tar.gz",
		"a\nb.pdf",
		`${"é".repeat(200)}.tar.gz`,
		`${"a".repeat(300)}.pdf`,
		"Dois  espaços.PDF",
	];
	for (const name of names) {
		const once = uploadFilename(name, restricted);
		expect(uploadFilename(once, restricted)).toBe(once);
		assertResponse(restricted, asResponse(once));
	}
});

test("uploadFilename: no multi-byte character survives sanitizing, so a stem of them is ASCII and within 255 bytes", () => {
	// `slugify` transliterates accents and drops CJK and emoji, so the byte-wise
	// truncation never meets a character wider than one byte; it is the
	// safeguard for a sanitizer that would keep them.
	for (const char of ["é", "ñ", "日本語", "😀"]) {
		const result = uploadFilename(`${char.repeat(300)}.pdf`, restricted);
		expect(result, char).toMatch(/^[\x20-\x7e]+$/);
		expect(Buffer.byteLength(result, "utf8"), char).toBeLessThanOrEqual(255);
		expect(result.endsWith(".pdf"), char).toBe(true);
	}
});
