import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statSync,
} from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import fc from "fast-check";
import type { Actor } from "@/core/actor";
import { FULL_ACCESS } from "@/core/actor";
import type { AttachmentLinkMode } from "@/core/constants";
import { prisma } from "@/db/client";
import { BlobService } from "@/db/services/blob.service";
import { hashBytes, isBlobHash } from "@/utils/content-hash";
import { TEST_RESOURCE_ROOT } from "./resource-root";

// A random suffix, not an incrementing counter: this file's own numbering
// would otherwise collide with identically-named counters in sibling spec
// files, since they all share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function hashOf(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** A fresh temp directory per test, isolated from every other test's blobs. */
function makeRoot(): string {
	const root = path.join(TEST_RESOURCE_ROOT, "blob-service", tag("root"));
	mkdirSync(root, { recursive: true });
	return root;
}

function makeService(
	opts: { linkMode?: AttachmentLinkMode } = {},
): BlobService {
	return new BlobService(prisma, { root: makeRoot(), linkMode: opts.linkMode });
}

const notSystem: Actor = { username: tag("user"), role: "STUDENT", name: "x" };

//
// hashBytes / isBlobHash — pure functions, tested against node:crypto as the
// oracle.
//

test("hashBytes agrees with node:crypto for arbitrary bytes, one-shot and chunked", () => {
	fc.assert(
		fc.property(fc.uint8Array({ maxLength: 2000 }), (bytes) => {
			const buf = Buffer.from(bytes);
			expect(hashBytes(buf)).toBe(hashOf(buf));

			// Chunked hashing (splitting the buffer and hashing each half through
			// the same primitive node:crypto would use) must agree with one-shot.
			const mid = Math.floor(buf.length / 2);
			const chunked = createHash("sha256")
				.update(buf.subarray(0, mid))
				.update(buf.subarray(mid))
				.digest("hex");
			expect(hashBytes(buf)).toBe(chunked);
		}),
		{ numRuns: 200 },
	);
});

test("hashBytes: the empty buffer hashes to the well-known sha-256 of nothing", () => {
	expect(hashBytes(Buffer.alloc(0))).toBe(
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	);
});

test("isBlobHash: true only for 64 lowercase hex characters", () => {
	expect(isBlobHash("a".repeat(64))).toBe(true);
	expect(isBlobHash("0123456789abcdef".repeat(4))).toBe(true);
	expect(isBlobHash("A".repeat(64))).toBe(false); // uppercase
	expect(isBlobHash("a".repeat(63))).toBe(false); // too short
	expect(isBlobHash("a".repeat(65))).toBe(false); // too long
	expect(isBlobHash("g".repeat(64))).toBe(false); // not hex
	expect(isBlobHash("")).toBe(false);
});

//
// BlobService
//

test("create: hashes the bytes, dedupes identical uploads into one row and one file, and rejects a corrupt contentHash writing nothing", async () => {
	const service = makeService();
	const bytes = Buffer.from(`hello ${tag("bytes")}`);
	const hash = hashOf(bytes);

	const first = await service.create({ bytes }, FULL_ACCESS);
	expect(first.hash).toBe(hash);
	expect(first.size).toBe(bytes.length);
	expect(first.deletedAt).toBeNull();
	expect(existsSync(service.blobPath(hash))).toBe(true);
	expect(readFileSync(service.blobPath(hash))).toEqual(bytes);

	const second = await service.create({ bytes }, FULL_ACCESS);
	expect(second.hash).toBe(first.hash);
	expect(second.createdAt).toEqual(first.createdAt); // untouched, not rewritten

	const corruptBytes = Buffer.from(`corrupt ${tag("bytes")}`);
	await expect(
		service.create(
			{ bytes: corruptBytes, contentHash: "0".repeat(64) },
			FULL_ACCESS,
		),
	).rejects.toThrow();
	expect(existsSync(service.blobPath(hashOf(corruptBytes)))).toBe(false);
	expect(await service.findOne({ hash: hashOf(corruptBytes) })).toBeNull();
});

test("create, delete and collectGarbage are SYSTEM-only", async () => {
	const service = makeService();
	const bytes = Buffer.from(`system-only ${tag("bytes")}`);

	await expect(
		service.create({ bytes }, { actor: notSystem }),
	).rejects.toThrow();

	const blob = await service.create({ bytes }, FULL_ACCESS);
	await expect(
		service.delete({ hash: blob.hash }, { actor: notSystem }),
	).rejects.toThrow();
	await expect(service.collectGarbage({ actor: notSystem })).rejects.toThrow();
});

test("delete is a no-op while an attachment points at the blob, and removes the file once none do", async () => {
	const service = makeService();
	const bytes = Buffer.from(`ref-counted ${tag("bytes")}`);
	const blob = await service.create({ bytes }, FULL_ACCESS);

	// Simulate one attachment pointing at the blob directly through Prisma —
	// AttachmentService is a separate unit under test elsewhere, and
	// BlobService's own refcounting only cares that a row exists.
	await prisma.attachment.create({
		data: {
			hash: blob.hash,
			filename: "note.txt",
			mimeType: "text/plain",
			ownerType: "RESOURCE",
			ownerId: 1,
		},
	});

	await service.delete({ hash: blob.hash }, FULL_ACCESS);
	expect(existsSync(service.blobPath(blob.hash))).toBe(true);
	let current = await service.findOne({ hash: blob.hash });
	expect(current?.deletedAt).toBeNull();

	await prisma.attachment.deleteMany({ where: { hash: blob.hash } });
	await service.delete({ hash: blob.hash }, FULL_ACCESS);
	expect(existsSync(service.blobPath(blob.hash))).toBe(false);
	current = await service.findOne({ hash: blob.hash });
	expect(current?.deletedAt).not.toBeNull();
});

test("create resurrects a tombstoned blob: deletedAt clears and the file is rewritten", async () => {
	const service = makeService();
	const bytes = Buffer.from(`resurrect-me ${tag("bytes")}`);
	const blob = await service.create({ bytes }, FULL_ACCESS);
	await service.delete({ hash: blob.hash }, FULL_ACCESS);
	expect(existsSync(service.blobPath(blob.hash))).toBe(false);

	const resurrected = await service.create({ bytes }, FULL_ACCESS);
	expect(resurrected.hash).toBe(blob.hash);
	expect(resurrected.deletedAt).toBeNull();
	expect(existsSync(service.blobPath(blob.hash))).toBe(true);
	expect(readFileSync(service.blobPath(blob.hash))).toEqual(bytes);
});

test("collectGarbage tombstones every unattached blob older than the cutoff, returns their hashes, and never touches an attached one", async () => {
	const service = makeService();
	const unattached = await service.create(
		{ bytes: Buffer.from(`gc-me ${tag("bytes")}`) },
		FULL_ACCESS,
	);
	const attached = await service.create(
		{ bytes: Buffer.from(`gc-spare-me ${tag("bytes")}`) },
		FULL_ACCESS,
	);
	await prisma.attachment.create({
		data: {
			hash: attached.hash,
			filename: "spared.txt",
			mimeType: "text/plain",
			ownerType: "RESOURCE",
			ownerId: 1,
		},
	});

	const cutoff = new Date(Date.now() + 1000); // safely after both creations
	const collected = await service.collectGarbage({
		actor: FULL_ACCESS.actor,
		olderThan: cutoff,
	});

	expect(collected).toContain(unattached.hash);
	expect(collected).not.toContain(attached.hash);

	const gone = await service.findOne({ hash: unattached.hash });
	expect(gone?.deletedAt).not.toBeNull();
	expect(existsSync(service.blobPath(unattached.hash))).toBe(false);

	const spared = await service.findOne({ hash: attached.hash });
	expect(spared?.deletedAt).toBeNull();
	expect(existsSync(service.blobPath(attached.hash))).toBe(true);
});

test("link modes: symlink, hardlink and copy each produce a readable file at the attachment's path", async () => {
	for (const linkMode of ["symlink", "hardlink", "copy"] as const) {
		const service = makeService({ linkMode });
		const bytes = Buffer.from(`linked ${linkMode} ${tag("bytes")}`);
		const blob = await service.create({ bytes }, FULL_ACCESS);

		await service.link(blob.hash, "note.txt");
		const attachmentPath = service.attachmentPath(blob.hash, "note.txt");
		expect(readFileSync(attachmentPath)).toEqual(bytes);

		if (linkMode === "symlink") {
			expect(lstatSync(attachmentPath).isSymbolicLink()).toBe(true);
			// Relative, and pointing at the bare hash — not an absolute path.
			const target = readlinkSync(attachmentPath);
			expect(path.isAbsolute(target)).toBe(false);
			expect(target).toBe(blob.hash);
		} else if (linkMode === "hardlink") {
			expect(lstatSync(attachmentPath).isSymbolicLink()).toBe(false);
			expect(statSync(attachmentPath).ino).toBe(
				statSync(service.blobPath(blob.hash)).ino,
			);
		} else {
			expect(lstatSync(attachmentPath).isSymbolicLink()).toBe(false);
			expect(statSync(attachmentPath).ino).not.toBe(
				statSync(service.blobPath(blob.hash)).ino,
			);
		}

		// Idempotent: relinking the same name doesn't error.
		await expect(service.link(blob.hash, "note.txt")).resolves.not.toThrow();
	}
});

test("unlink on a missing name is a no-op, and removing one of two names sharing a blob leaves the other readable", async () => {
	const service = makeService();
	const bytes = Buffer.from(`two-names ${tag("bytes")}`);
	const blob = await service.create({ bytes }, FULL_ACCESS);

	await expect(
		service.unlink(blob.hash, "never-linked.txt"),
	).resolves.not.toThrow();

	await service.link(blob.hash, "first.txt");
	await service.link(blob.hash, "second.txt");
	await service.unlink(blob.hash, "first.txt");

	expect(existsSync(service.attachmentPath(blob.hash, "first.txt"))).toBe(
		false,
	);
	expect(readFileSync(service.attachmentPath(blob.hash, "second.txt"))).toEqual(
		bytes,
	);
});

test("readBlob returns bytes for a live blob, null for a tombstoned one, and null when the bytes are missing from disk", async () => {
	const service = makeService();
	const bytes = Buffer.from(`readable ${tag("bytes")}`);
	const blob = await service.create({ bytes }, FULL_ACCESS);

	expect(await service.readBlob(blob)).toEqual(bytes);

	await service.delete({ hash: blob.hash }, FULL_ACCESS);
	const tombstoned = await service.findOne({ hash: blob.hash });
	expect(tombstoned).not.toBeNull();
	if (tombstoned) {
		expect(await service.readBlob(tombstoned)).toBeNull();
	}

	// A live row whose bytes vanished from disk out from under it.
	const missing = await service.create(
		{ bytes: Buffer.from(`vanishing ${tag("bytes")}`) },
		FULL_ACCESS,
	);
	rmSync(service.blobPath(missing.hash));
	expect(await service.readBlob(missing)).toBeNull();
});

test("disk layout: bytes at <root>/<hash[0:2]>/<hash>/<hash>, an attachment name beside it", async () => {
	const service = makeService();
	const bytes = Buffer.from(`layout ${tag("bytes")}`);
	const blob = await service.create({ bytes }, FULL_ACCESS);
	await service.link(blob.hash, "readme.txt");

	const expectedBlobPath = path.join(service.blobDir(blob.hash), blob.hash);
	expect(service.blobPath(blob.hash)).toBe(expectedBlobPath);
	expect(service.blobDir(blob.hash)).toBe(
		path.join(service.root, blob.hash.slice(0, 2), blob.hash),
	);
	expect(service.attachmentPath(blob.hash, "readme.txt")).toBe(
		path.join(service.blobDir(blob.hash), "readme.txt"),
	);
});
