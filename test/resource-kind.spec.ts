import { expect, test } from "@playwright/test";
import { resourceDetail, resourceKind } from "../src/utils/resource-kind";

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

test("a resource's detail line is its description when it has one", () => {
	expect(
		resourceDetail({ description: "Course policy.", data: { type: "MD" } }),
	).toBe("Course policy.");
});

test("without a description, a link shows its site and the rest their kind", () => {
	expect(
		resourceDetail({
			description: null,
			data: { type: "LINK", url: "https://www.python.org/doc/" },
		}),
	).toBe("python.org");
	expect(
		resourceDetail({
			description: null,
			data: { type: "CODE", language: "python" },
		}),
	).toBe("python");
	expect(
		resourceDetail({ description: null, data: { type: "LINK", url: "nope" } }),
	).toBe("Link");
});
