/**
 * The rules of a question's attachments that need no database: which names
 * are links, how big the fenced ones are, and whether the bytes sent along
 * match the hashes that cite them.
 */

import { SYSTEM } from "@/auth/actor";
import { MAX_FENCED_ATTACHMENT_BYTES } from "@/core/constants";
import { InvalidData, NotFound } from "@/core/error";
import type { PrismaTx } from "@/db/client";
import type { BlobService } from "@/db/services/blob.service";
import type { QuestionDocument } from "@/mdq";
import { hashBytes } from "@/utils/content-hash";
import { mimeFor } from "@/utils/mime";

/// Anything that holds the `attachments` of an MDQ document: a question or an exam.
export type WithAttachments = Pick<QuestionDocument, "attachments">;

/// Map from the name of a link attachment to the sha256 of its bytes.
export type AttachmentFiles = Record<string, string>;

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
	given: AttachmentFiles | undefined,
	inherited: AttachmentFiles | null,
): AttachmentFiles {
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
function pick(files: AttachmentFiles, names: string[]): AttachmentFiles {
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
	files: AttachmentFiles,
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

/** A `files` map as a column holds it: `undefined` for none, which leaves the column unset. */
export function filesColumn(
	files: AttachmentFiles,
): AttachmentFiles | undefined {
	return Object.keys(files).length > 0 ? files : undefined;
}

/** Whether two `files` maps are the same, `null` and `{}` counting as equal. */
export function sameFiles(
	a: AttachmentFiles | null | undefined,
	b: AttachmentFiles | null | undefined,
): boolean {
	const x = Object.entries(a ?? {}).sort(([p], [q]) => p.localeCompare(q));
	const y = Object.entries(b ?? {}).sort(([p], [q]) => p.localeCompare(q));
	return JSON.stringify(x) === JSON.stringify(y);
}

/**
 * The bytes of the attachment `name` among `attachments`: a fenced one comes
 * from its text, a link from the blob `files` maps its name to.
 *
 * @throws {@link NotFound} If there is no such attachment or its blob is gone.
 */
export async function serveAttachmentFile(
	blob: BlobService,
	tx: PrismaTx,
	attachments: WithAttachments["attachments"] | null | undefined,
	files: AttachmentFiles | null | undefined,
	name: string,
): Promise<{ bytes: Buffer; mimeType: string; filename: string }> {
	const entry = attachments?.find((a) => a.name === name);
	if (!entry) throw new NotFound("attachment");

	if (entry.text !== undefined) {
		return {
			bytes: Buffer.from(entry.text, "utf-8"),
			mimeType: "text/plain; charset=utf-8",
			filename: entry.name,
		};
	}
	const hash = files?.[name];
	const stored = hash
		? await blob.findOne({ hash }, { tx, actor: SYSTEM })
		: null;
	const bytes = stored && (await blob.readBlob(stored));
	if (!bytes) throw new NotFound("attachment");
	return { bytes, mimeType: mimeFor(entry.name), filename: entry.name };
}
