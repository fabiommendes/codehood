import { expect, test } from "@playwright/test";
import { resourceKind } from "../src/utils/resource-kind";

test("a file reads as its extension, not its MIME type", () => {
	expect(resourceKind({ type: "FILE", mimeType: "application/pdf" })).toBe(
		"PDF file",
	);
	expect(resourceKind({ type: "FILE", mimeType: "text/plain" })).toBe(
		"TXT file",
	);
});

test("a file of an unknown type reads as a plain file", () => {
	expect(resourceKind({ type: "FILE", mimeType: "application/x-nope" })).toBe(
		"File",
	);
});

test("links, notes and snippets", () => {
	expect(resourceKind({ type: "LINK" })).toBe("Link");
	expect(resourceKind({ type: "MD" })).toBe("Note");
	expect(resourceKind({ type: "CODE", language: "python" })).toBe("python");
});
