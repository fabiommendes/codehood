import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { BLOB_QUOTA_BY_ROLE } from "@/core/constants";
import { prisma } from "@/db/client";
import { AttachmentService } from "@/db/services/attachment.service";
import { BlobService } from "@/db/services/blob.service";
import { userService } from "@/db/services/user.service";
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

function randomOwnerId(): number {
	return Math.floor(Math.random() * 1_000_000_000);
}

/** A fresh temp directory per test, isolated from every other test's blobs. */
function makeRoot(): string {
	const root = path.join(TEST_RESOURCE_ROOT, "attachment-service", tag("root"));
	mkdirSync(root, { recursive: true });
	return root;
}

function makeService(): AttachmentService {
	return new AttachmentService(
		prisma,
		new BlobService(prisma, { root: makeRoot() }),
	);
}

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return userService.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: "x",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

test("create sanitises the filename and returns it, and a known extension overrides a mismatched declared mime type", async () => {
	const service = makeService();
	const ownerId = randomOwnerId();
	const bytes = Buffer.from(`hello ${tag("bytes")}`);

	const attachment = await service.create(
		{
			bytes,
			filename: "Week 1 Notes.PDF",
			mimeType: "application/octet-stream",
			ownerType: "RESOURCE",
			ownerId,
		},
		FULL_ACCESS,
	);

	expect(attachment.filename).toBe("week-1-notes.pdf");
	expect(attachment.mimeType).toBe("application/pdf");
	expect(
		readFileSync(
			service.blobs.attachmentPath(attachment.hash, "week-1-notes.pdf"),
		),
	).toEqual(bytes);
});

test("create keeps the declared mime type when the extension is unknown", async () => {
	const service = makeService();
	const attachment = await service.create(
		{
			bytes: Buffer.from(`custom ${tag("bytes")}`),
			filename: "part.dwg",
			mimeType: "application/acad",
			ownerType: "RESOURCE",
			ownerId: randomOwnerId(),
		},
		FULL_ACCESS,
	);
	expect(attachment.mimeType).toBe("application/acad");
});

test("two attachments sharing a blob and a sanitised filename share one link; delete unlinks only once the last is gone", async () => {
	const service = makeService();
	const bytes = Buffer.from(`shared-name ${tag("bytes")}`);
	const ownerA = randomOwnerId();
	const ownerB = randomOwnerId();

	const first = await service.create(
		{
			bytes,
			filename: "Note.TXT",
			ownerType: "RESOURCE",
			ownerId: ownerA,
		},
		FULL_ACCESS,
	);
	const second = await service.create(
		{
			bytes,
			filename: "note.txt",
			ownerType: "RESOURCE",
			ownerId: ownerB,
		},
		FULL_ACCESS,
	);
	expect(first.hash).toBe(second.hash);
	expect(first.filename).toBe("note.txt");
	expect(second.filename).toBe("note.txt");

	const linkPath = service.blobs.attachmentPath(first.hash, "note.txt");
	expect(existsSync(linkPath)).toBe(true);

	await service.delete({ id: first.id }, FULL_ACCESS);
	expect(existsSync(linkPath)).toBe(true); // second attachment still holds it

	await service.delete({ id: second.id }, FULL_ACCESS);
	expect(existsSync(linkPath)).toBe(false);
});

test("update renames: links the new name and unlinks the old one when no sibling holds it", async () => {
	const service = makeService();
	const bytes = Buffer.from(`rename-me ${tag("bytes")}`);
	const attachment = await service.create(
		{
			bytes,
			filename: "old.txt",
			ownerType: "RESOURCE",
			ownerId: randomOwnerId(),
		},
		FULL_ACCESS,
	);
	const oldPath = service.blobs.attachmentPath(attachment.hash, "old.txt");
	expect(existsSync(oldPath)).toBe(true);

	const updated = await service.update(
		{ id: attachment.id },
		{ filename: "New Name.txt" },
		FULL_ACCESS,
	);
	expect(updated.filename).toBe("new-name.txt");
	const newPath = service.blobs.attachmentPath(attachment.hash, "new-name.txt");
	expect(readFileSync(newPath)).toEqual(bytes);
	expect(existsSync(oldPath)).toBe(false);
});

test("detachOwner deletes every attachment of one owner and returns the count, leaving other owners untouched", async () => {
	const service = makeService();
	const ownerId = randomOwnerId();
	const otherOwnerId = randomOwnerId();

	await service.create(
		{
			bytes: Buffer.from(`one ${tag("bytes")}`),
			filename: "a.txt",
			ownerType: "RESOURCE",
			ownerId,
		},
		FULL_ACCESS,
	);
	await service.create(
		{
			bytes: Buffer.from(`two ${tag("bytes")}`),
			filename: "b.txt",
			ownerType: "RESOURCE",
			ownerId,
		},
		FULL_ACCESS,
	);
	await service.create(
		{
			bytes: Buffer.from(`other-owner ${tag("bytes")}`),
			filename: "c.txt",
			ownerType: "RESOURCE",
			ownerId: otherOwnerId,
		},
		FULL_ACCESS,
	);

	const count = await service.detachOwner("RESOURCE", ownerId, FULL_ACCESS);
	expect(count).toBe(2);

	await expect(
		service.findMany({ ownerIds: [ownerId] }, FULL_ACCESS),
	).resolves.toHaveLength(0);
	await expect(
		service.findMany({ ownerIds: [otherOwnerId] }, FULL_ACCESS),
	).resolves.toHaveLength(1);
});

test("forOwners returns a Map keyed by owner id, and an id with no attachments is simply absent", async () => {
	const service = makeService();
	const ownerA = randomOwnerId();
	const ownerB = randomOwnerId();
	const ownerC = randomOwnerId(); // never used

	await service.create(
		{
			bytes: Buffer.from(`owner-a ${tag("bytes")}`),
			filename: "a.txt",
			ownerType: "RESOURCE",
			ownerId: ownerA,
		},
		FULL_ACCESS,
	);
	await service.create(
		{
			bytes: Buffer.from(`owner-b-1 ${tag("bytes")}`),
			filename: "b1.txt",
			ownerType: "RESOURCE",
			ownerId: ownerB,
		},
		FULL_ACCESS,
	);
	await service.create(
		{
			bytes: Buffer.from(`owner-b-2 ${tag("bytes")}`),
			filename: "b2.txt",
			ownerType: "RESOURCE",
			ownerId: ownerB,
		},
		FULL_ACCESS,
	);

	const map = await service.forOwners("RESOURCE", [ownerA, ownerB, ownerC]);
	expect(map.get(ownerA)).toHaveLength(1);
	expect(map.get(ownerB)).toHaveLength(2);
	expect(map.has(ownerC)).toBe(false);
});

test("usageBytes sums a user's attachment bytes and is unmoved by another user uploading identical bytes", async () => {
	const service = makeService();
	const userA = await makeUser("STUDENT");
	const userB = await makeUser("STUDENT");
	const bytes = Buffer.from(`shared-bytes ${tag("bytes")}`);

	await service.create(
		{
			bytes,
			filename: "a.txt",
			uploaderUsername: userA.username,
			ownerType: "RESOURCE",
			ownerId: randomOwnerId(),
		},
		FULL_ACCESS,
	);
	await expect(service.usageBytes(userA.username)).resolves.toBe(bytes.length);

	await service.create(
		{
			bytes,
			filename: "b.txt",
			uploaderUsername: userB.username,
			ownerType: "RESOURCE",
			ownerId: randomOwnerId(),
		},
		FULL_ACCESS,
	);
	await expect(service.usageBytes(userA.username)).resolves.toBe(bytes.length);
	await expect(service.usageBytes(userB.username)).resolves.toBe(bytes.length);
});

test("quotaFor reads BLOB_QUOTA_BY_ROLE, and ADMIN has no limit", () => {
	const service = makeService();
	expect(service.quotaFor("ADMIN")).toBeNull();
	expect(service.quotaFor("STUDENT")).toBe(BLOB_QUOTA_BY_ROLE.STUDENT);
	expect(service.quotaFor("INSTRUCTOR")).toBe(BLOB_QUOTA_BY_ROLE.INSTRUCTOR);
});

test("assertWithinQuota allows exactly up to the limit and throws one byte past it; SYSTEM and ADMIN are unlimited", async () => {
	const service = makeService();
	const student = await makeUser("STUDENT");
	const admin = await makeUser("ADMIN");
	const bytes = Buffer.from(`quota-seed ${tag("bytes")}`);

	await service.create(
		{
			bytes,
			filename: "seed.txt",
			uploaderUsername: student.username,
			ownerType: "RESOURCE",
			ownerId: randomOwnerId(),
		},
		FULL_ACCESS,
	);
	const usage = await service.usageBytes(student.username);
	const quota = BLOB_QUOTA_BY_ROLE.STUDENT;
	if (quota === null) {
		throw new Error("test assumes STUDENT has a finite quota");
	}
	const remaining = quota - usage;

	await expect(
		service.assertWithinQuota(remaining, { actor: student }),
	).resolves.not.toThrow();
	await expect(
		service.assertWithinQuota(remaining + 1, { actor: student }),
	).rejects.toThrow();

	await expect(
		service.assertWithinQuota(Number.MAX_SAFE_INTEGER, { actor: admin }),
	).resolves.not.toThrow();
	await expect(
		service.assertWithinQuota(Number.MAX_SAFE_INTEGER, FULL_ACCESS),
	).resolves.not.toThrow();
});

test("create refuses an upload that would exceed the actor's quota, writing nothing to disk or the ledger", async () => {
	const service = makeService();
	const student = await makeUser("STUDENT");
	const quota = BLOB_QUOTA_BY_ROLE.STUDENT;
	if (quota === null) {
		throw new Error("test assumes STUDENT has a finite quota");
	}

	// Seed usage to just under the quota with a fabricated Blob row — a real
	// upload of hundreds of megabytes has no place in a unit test, and the
	// quota check only reads `blob.size`, never the bytes on disk.
	const seedBytes = Buffer.from(`quota-filler ${tag("bytes")}`);
	const seedHash = hashOf(seedBytes);
	await prisma.blob.create({
		data: { hash: seedHash, size: quota - 10 },
	});
	await prisma.attachment.create({
		data: {
			hash: seedHash,
			filename: "filler.txt",
			mimeType: "text/plain",
			uploaderUsername: student.username,
			ownerType: "RESOURCE",
			ownerId: randomOwnerId(),
		},
	});
	await expect(service.usageBytes(student.username)).resolves.toBe(quota - 10);

	const tooBig = Buffer.from("x".repeat(20));
	const ownerId = randomOwnerId();
	await expect(
		service.create(
			{
				bytes: tooBig,
				filename: "over-quota.txt",
				uploaderUsername: student.username,
				ownerType: "RESOURCE",
				ownerId,
			},
			{ actor: student },
		),
	).rejects.toThrow();

	expect(existsSync(service.blobs.blobPath(hashOf(tooBig)))).toBe(false);
	await expect(
		service.findMany({ ownerIds: [ownerId] }, FULL_ACCESS),
	).resolves.toHaveLength(0);
});
