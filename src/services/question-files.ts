/**
 * The rules of a question's attachments that need no database: which names
 * are links, how big the fenced ones are, and whether the bytes sent along
 * match the hashes that cite them.
 */
import { MAX_FENCED_ATTACHMENT_BYTES } from "@/core/constants";
import { InvalidData } from "@/core/error";
import type { QuestionDocument } from "@/mdq";
import { hashBytes } from "@/utils/content-hash";

/// Anything that holds the `attachments` of an MDQ document: a question or an exam.
export type WithAttachments = Pick<QuestionDocument, "attachments">;

/// Map from the name of a link attachment to the sha256 of its bytes.
export type QuestionFiles = Record<string, string>;

/// An error on one field of the write, in the shape `InvalidData` takes.
function invalid(field: string, message: string): InvalidData {
	return new InvalidData(
		{ [field]: [{ code: "invalid", message }] },
		{ message },
	);
}

/** The names of the attachments of `question` that are links, in document order. */
export function linkAttachmentNames(question: WithAttachments): string[] {
	return (question.attachments ?? [])
		.filter((a) => a.text === undefined)
		.map((a) => a.name);
}

/**
 * Refuses a document whose fenced attachments sum to more than
 * `MAX_FENCED_ATTACHMENT_BYTES` of UTF-8 text, reporting it on `field`.
 *
 * @throws {@link InvalidData}
 */
export function assertFencedWithinLimit(
	question: WithAttachments,
	field = "question",
): void {
	const total = (question.attachments ?? []).reduce(
		(sum, a) => sum + (a.text === undefined ? 0 : Buffer.byteLength(a.text)),
		0,
	);
	if (total > MAX_FENCED_ATTACHMENT_BYTES) {
		throw invalid(
			field,
			`The fenced attachments total ${total} bytes, over the limit of ${MAX_FENCED_ATTACHMENT_BYTES}.`,
		);
	}
}

/**
 * The `files` of a write: `given` when the caller sent it, else what the
 * `inherited` version has for the names that are still links.
 *
 * Every link of `question` ends with a hash, and no name that is not a link
 * has one.
 *
 * @throws {@link InvalidData}
 */
export function resolveFiles(
	question: WithAttachments,
	given: QuestionFiles | undefined,
	inherited: QuestionFiles | null,
): QuestionFiles {
	const links = linkAttachmentNames(question);
	const files = given ?? pick(inherited ?? {}, links);

	for (const name of Object.keys(files)) {
		if (!links.includes(name)) {
			throw invalid("files", `"${name}" is not a link attachment.`);
		}
	}
	for (const name of links) {
		if (!(name in files)) {
			throw invalid("files", `The link attachment "${name}" has no file.`);
		}
	}
	return files;
}

/// The entries of `files` whose names are in `names`.
function pick(files: QuestionFiles, names: string[]): QuestionFiles {
	return Object.fromEntries(
		Object.entries(files).filter(([name]) => names.includes(name)),
	);
}

/**
 * Refuses a buffer that is not under its own sha256, or that no hash of
 * `files` cites.
 *
 * @throws {@link InvalidData}
 */
export function assertBlobsMatch(
	blobs: Record<string, Buffer>,
	files: QuestionFiles,
): void {
	const cited = new Set(Object.values(files));
	for (const [hash, bytes] of Object.entries(blobs)) {
		if (hashBytes(bytes) !== hash) {
			throw invalid("blobs", `The bytes sent as ${hash} do not hash to it.`);
		}
		if (!cited.has(hash)) {
			throw invalid("blobs", `The bytes ${hash} are not cited by any file.`);
		}
	}
}

/// A `files` map as a column holds it: `null` for none.
export function filesColumn(files: QuestionFiles): QuestionFiles | undefined {
	return Object.keys(files).length > 0 ? files : undefined;
}

/// Whether two `files` maps are the same, `null` and `{}` counting as equal.
export function sameFiles(
	a: QuestionFiles | null | undefined,
	b: QuestionFiles | null | undefined,
): boolean {
	const x = Object.entries(a ?? {}).sort(([p], [q]) => p.localeCompare(q));
	const y = Object.entries(b ?? {}).sort(([p], [q]) => p.localeCompare(q));
	return JSON.stringify(x) === JSON.stringify(y);
}
