import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

/// Bytes of a file and the sha256 the services key it by.
export type Blob = { bytes: Buffer; hash: string };

export function blobOf(content: string): Blob {
	const bytes = Buffer.from(content);
	return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}

/// An attachment entry of a question or exam document.
export type Entry =
	| { name: string; format: string; text: string }
	| { name: string; format: string; origin: string };

/// A link attachment whose origin is its own name.
export function link(name: string): Entry {
	return { name, format: name.split(".").pop() ?? "csv", origin: name };
}

/// The `files` and `blobs` fields of a write that stores `blobs` under their names.
export function filesOf(blobs: Record<string, Blob>) {
	return {
		files: Object.fromEntries(
			Object.entries(blobs).map(([name, b]) => [name, b.hash]),
		),
		blobs: Object.fromEntries(
			Object.values(blobs).map((b) => [b.hash, b.bytes]),
		),
	};
}

/// Creates a published multiple-choice question carrying `attachments`.
export async function createQuestion(input: {
	course: number;
	slug: string;
	version: string;
	stem: string;
	attachments: Entry[];
	blobs: Record<string, Blob>;
}) {
	return db.question.create(
		{
			course: input.course,
			slug: input.slug,
			status: "PUBLISHED",
			version: input.version,
			question: {
				type: "multiple-choice",
				title: input.slug,
				stem: input.stem,
				choices: [
					{ id: "a", text: "Alpha", score: 1 },
					{ id: "b", text: "Beta" },
				],
				...(input.attachments.length > 0
					? { attachments: input.attachments }
					: {}),
			},
			...filesOf(input.blobs),
		} as Parameters<typeof db.question.create>[0],
		FULL_ACCESS,
	);
}

/// The list of attached files that contains a download link for `fileName`.
///
/// The UI contract: a region named "Attachments" whose items are links named
/// after the file.
export function attachmentsWith(page: Page, fileName: string): Locator {
	return page
		.getByRole("region", { name: "Attachments", exact: true })
		.filter({ has: page.getByRole("link", { name: fileName }) });
}

/// Clicks the download link of `fileName` inside `list` and returns the bytes saved.
export async function download(
	page: Page,
	list: Locator,
	fileName: string,
): Promise<{ filename: string; bytes: Buffer }> {
	const [saved] = await Promise.all([
		page.waitForEvent("download"),
		list.getByRole("link", { name: fileName }).click(),
	]);
	return {
		filename: saved.suggestedFilename(),
		bytes: await readFile(await saved.path()),
	};
}

/// True when `upper` ends before `lower` starts on the page.
export async function isAbove(upper: Locator, lower: Locator) {
	const a = await upper.boundingBox();
	const b = await lower.boundingBox();
	return a !== null && b !== null && a.y + a.height <= b.y + 1;
}
