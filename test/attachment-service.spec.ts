import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { BLOB_QUOTA_BY_ROLE } from "@/core/constants";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedResourceFactory } from "@/fixtures/resource.factory";

// A random suffix, not an incrementing counter: this file's own numbering
// would otherwise collide with identically-named counters in sibling spec
// files, since they all share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function hashOf(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function makeUser(role: "ADMIN" | "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return db.user.create(
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

/**
 * A real, persisted resource under a shared course: `create` looks a
 * resource's title/slug up by id, so this cannot be faked with a bare number.
 *
 * Every resource in this file shares one course rather than provisioning its
 * own — a fresh course pulls in a fresh edition, and the edition factory
 * cycles through only 20 slugs, which a suite this size exhausts.
 */
let sharedCourseId: CourseId;

test.beforeAll(async () => {
	// An explicit, randomised edition: `persistedCourseFactory`'s own default
	// cycles through only 20 year/term slugs, which collides with the ones
	// `bootstrap` seeds into every test database.
	const edition = await db.edition.create(
		{
			slug: `${1000 + Math.floor(Math.random() * 9000)}`,
			name: "attachment-service test edition",
			startAt: new Date(),
			endAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
		},
		FULL_ACCESS,
	);
	sharedCourseId = (
		await persistedCourseFactory.create({ edition: edition.slug })
	).id;
});

async function makeResource() {
	return persistedResourceFactory.create({ courseId: sharedCourseId });
}

test("create sanitises the filename and derives the mime type from a known extension", async () => {
	const resource = await makeResource();
	const bytes = Buffer.from(`hello ${tag("bytes")}`);

	const attachment = await db.attachment.create(
		{
			buffer: bytes,
			filename: "Week 1 Notes.PDF",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);

	expect(attachment.filename).toBe("week-1-notes.pdf");
	expect(attachment.mimeType).toBe("application/pdf");
	expect(
		readFileSync(db.blob.attachmentPath(attachment.hash, "week-1-notes.pdf")),
	).toEqual(bytes);
});

test("create falls back to application/octet-stream when the extension is unknown", async () => {
	const resource = await makeResource();

	const attachment = await db.attachment.create(
		{
			buffer: Buffer.from(`custom ${tag("bytes")}`),
			filename: "part.dwg",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);
	expect(attachment.mimeType).toBe("application/octet-stream");
});

test("two attachments sharing a blob and a sanitised filename share one link; delete unlinks only once the last is gone", async () => {
	const bytes = Buffer.from(`shared-name ${tag("bytes")}`);
	const resourceA = await makeResource();
	const resourceB = await makeResource();

	const first = await db.attachment.create(
		{
			buffer: bytes,
			filename: "Note.TXT",
			attachedTo: { type: "RESOURCE", id: resourceA.id },
		},
		FULL_ACCESS,
	);
	const second = await db.attachment.create(
		{
			buffer: bytes,
			filename: "note.txt",
			attachedTo: { type: "RESOURCE", id: resourceB.id },
		},
		FULL_ACCESS,
	);
	expect(first.hash).toBe(second.hash);
	expect(first.filename).toBe("note.txt");
	expect(second.filename).toBe("note.txt");

	const linkPath = db.blob.attachmentPath(first.hash, "note.txt");
	expect(existsSync(linkPath)).toBe(true);

	await db.attachment.delete({ id: first.id }, FULL_ACCESS);
	expect(existsSync(linkPath)).toBe(true); // second attachment still holds it

	await db.attachment.delete({ id: second.id }, FULL_ACCESS);
	expect(existsSync(linkPath)).toBe(false);
});

test("update renames: links the new name and unlinks the old one when no sibling holds it", async () => {
	const bytes = Buffer.from(`rename-me ${tag("bytes")}`);
	const resource = await makeResource();
	const attachment = await db.attachment.create(
		{
			buffer: bytes,
			filename: "old.txt",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);
	const oldPath = db.blob.attachmentPath(attachment.hash, "old.txt");
	expect(existsSync(oldPath)).toBe(true);

	const updated = await db.attachment.update(
		{ id: attachment.id },
		{ filename: "New Name.txt" },
		FULL_ACCESS,
	);
	expect(updated.filename).toBe("new-name.txt");
	const newPath = db.blob.attachmentPath(attachment.hash, "new-name.txt");
	expect(readFileSync(newPath)).toEqual(bytes);
	expect(existsSync(oldPath)).toBe(false);
});

test("detach deletes every attachment of one owner and returns the count, leaving other owners untouched", async () => {
	const resource = await makeResource();
	const otherResource = await makeResource();

	await db.attachment.create(
		{
			buffer: Buffer.from(`one ${tag("bytes")}`),
			filename: "a.txt",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);
	await db.attachment.create(
		{
			buffer: Buffer.from(`two ${tag("bytes")}`),
			filename: "b.txt",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);
	await db.attachment.create(
		{
			buffer: Buffer.from(`other-owner ${tag("bytes")}`),
			filename: "c.txt",
			attachedTo: { type: "RESOURCE", id: otherResource.id },
		},
		FULL_ACCESS,
	);

	const { deleted } = await db.attachment.detach(
		"RESOURCE",
		resource.id,
		FULL_ACCESS,
	);
	expect(deleted).toBe(2);

	await expect(
		db.attachment.findMany({ attachedTo: [resource.id] }, FULL_ACCESS),
	).resolves.toHaveLength(0);
	await expect(
		db.attachment.findMany({ attachedTo: [otherResource.id] }, FULL_ACCESS),
	).resolves.toHaveLength(1);
});

test("allAttachedTo returns the attachments recorded against one resource, and a resource with none gets an empty array", async () => {
	const resourceA = await makeResource();
	const resourceB = await makeResource();
	const resourceC = await makeResource(); // never used

	await db.attachment.create(
		{
			buffer: Buffer.from(`owner-a ${tag("bytes")}`),
			filename: "a.txt",
			attachedTo: { type: "RESOURCE", id: resourceA.id },
		},
		FULL_ACCESS,
	);
	await db.attachment.create(
		{
			buffer: Buffer.from(`owner-b-1 ${tag("bytes")}`),
			filename: "b1.txt",
			attachedTo: { type: "RESOURCE", id: resourceB.id },
		},
		FULL_ACCESS,
	);
	await db.attachment.create(
		{
			buffer: Buffer.from(`owner-b-2 ${tag("bytes")}`),
			filename: "b2.txt",
			attachedTo: { type: "RESOURCE", id: resourceB.id },
		},
		FULL_ACCESS,
	);

	await expect(
		db.attachment.allAttachedTo({
			type: "RESOURCE",
			id: resourceA.id,
			title: resourceA.title,
			slug: resourceA.slug,
		}),
	).resolves.toHaveLength(1);
	await expect(
		db.attachment.allAttachedTo({
			type: "RESOURCE",
			id: resourceB.id,
			title: resourceB.title,
			slug: resourceB.slug,
		}),
	).resolves.toHaveLength(2);
	await expect(
		db.attachment.allAttachedTo({
			type: "RESOURCE",
			id: resourceC.id,
			title: resourceC.title,
			slug: resourceC.slug,
		}),
	).resolves.toHaveLength(0);
});

test("usageBytes sums a user's attachment bytes and is unmoved by another user uploading identical bytes", async () => {
	const userA = await makeUser("STUDENT");
	const userB = await makeUser("STUDENT");
	const bytes = Buffer.from(`shared-bytes ${tag("bytes")}`);
	const resourceA = await makeResource();
	const resourceB = await makeResource();

	await db.attachment.create(
		{
			buffer: bytes,
			filename: "a.txt",
			uploaderId: userA.username,
			attachedTo: { type: "RESOURCE", id: resourceA.id },
		},
		FULL_ACCESS,
	);
	await expect(db.attachment.usageBytes(userA.username)).resolves.toBe(
		bytes.length,
	);

	await db.attachment.create(
		{
			buffer: bytes,
			filename: "b.txt",
			uploaderId: userB.username,
			attachedTo: { type: "RESOURCE", id: resourceB.id },
		},
		FULL_ACCESS,
	);
	await expect(db.attachment.usageBytes(userA.username)).resolves.toBe(
		bytes.length,
	);
	await expect(db.attachment.usageBytes(userB.username)).resolves.toBe(
		bytes.length,
	);
});

test("quotaFor reads BLOB_QUOTA_BY_ROLE, and ADMIN has no limit", () => {
	expect(db.attachment.quotaFor("ADMIN")).toBeNull();
	expect(db.attachment.quotaFor("STUDENT")).toBe(BLOB_QUOTA_BY_ROLE.STUDENT);
	expect(db.attachment.quotaFor("INSTRUCTOR")).toBe(
		BLOB_QUOTA_BY_ROLE.INSTRUCTOR,
	);
});

test("assertWithinQuota allows exactly up to the limit and throws one byte past it; SYSTEM and ADMIN are unlimited", async () => {
	const student = await makeUser("STUDENT");
	const admin = await makeUser("ADMIN");
	const bytes = Buffer.from(`quota-seed ${tag("bytes")}`);
	const resource = await makeResource();

	await db.attachment.create(
		{
			buffer: bytes,
			filename: "seed.txt",
			uploaderId: student.username,
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);
	const usage = await db.attachment.usageBytes(student.username);
	const quota = BLOB_QUOTA_BY_ROLE.STUDENT;
	if (quota === null) {
		throw new Error("test assumes STUDENT has a finite quota");
	}
	const remaining = quota - usage;

	await expect(
		db.attachment.assertWithinQuota(remaining, { actor: student }),
	).resolves.not.toThrow();
	await expect(
		db.attachment.assertWithinQuota(remaining + 1, { actor: student }),
	).rejects.toThrow();

	await expect(
		db.attachment.assertWithinQuota(Number.MAX_SAFE_INTEGER, { actor: admin }),
	).resolves.not.toThrow();
	await expect(
		db.attachment.assertWithinQuota(Number.MAX_SAFE_INTEGER, FULL_ACCESS),
	).resolves.not.toThrow();
});

test("create refuses an upload that would exceed the actor's quota, writing nothing to disk or the ledger", async () => {
	const student = await makeUser("STUDENT");
	const quota = BLOB_QUOTA_BY_ROLE.STUDENT;
	if (quota === null) {
		throw new Error("test assumes STUDENT has a finite quota");
	}

	// Seed usage to just under the quota with a fabricated Blob row — a real
	// upload of hundreds of megabytes has no place in a unit test, and the
	// quota check only reads `blob.size`, never the bytes on disk.
	const fillerResource = await makeResource();
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
			uploaderId: student.username,
			attachedToType: "RESOURCE",
			attachedToId: fillerResource.id,
		},
	});
	await expect(db.attachment.usageBytes(student.username)).resolves.toBe(
		quota - 10,
	);

	const tooBig = Buffer.from("x".repeat(20));
	const targetResource = await makeResource();
	await expect(
		db.attachment.create(
			{
				buffer: tooBig,
				filename: "over-quota.txt",
				uploaderId: student.username,
				attachedTo: { type: "RESOURCE", id: targetResource.id },
			},
			{ actor: student },
		),
	).rejects.toThrow();

	expect(existsSync(db.blob.blobPath(hashOf(tooBig)))).toBe(false);
	await expect(
		db.attachment.findMany({ attachedTo: [targetResource.id] }, FULL_ACCESS),
	).resolves.toHaveLength(0);
});
