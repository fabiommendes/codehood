import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { BLOB_QUOTA_BY_ROLE } from "@/core/constants";
import { NotAllowed } from "@/core/error";
import type { CourseId } from "@/core/schemas/base";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedResourceFactory } from "@/fixtures/resource.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { addDays, todayIn } from "@/utils/schedule-time";

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
			startDate: todayIn(),
			endDate: addDays(todayIn(), 1),
		},
		FULL_ACCESS,
	);
	sharedCourseId = (
		await persistedCourseFactory.create({ edition: edition.slug })
	).id;
});

async function makeResource() {
	return persistedResourceFactory.create({ course: sharedCourseId });
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
		db.attachment.allAttachedTo(
			{
				type: "RESOURCE",
				id: resourceA.id,
				title: resourceA.title,
				slug: resourceA.slug,
			},
			FULL_ACCESS,
		),
	).resolves.toHaveLength(1);
	await expect(
		db.attachment.allAttachedTo(
			{
				type: "RESOURCE",
				id: resourceB.id,
				title: resourceB.title,
				slug: resourceB.slug,
			},
			FULL_ACCESS,
		),
	).resolves.toHaveLength(2);
	await expect(
		db.attachment.allAttachedTo(
			{
				type: "RESOURCE",
				id: resourceC.id,
				title: resourceC.title,
				slug: resourceC.slug,
			},
			FULL_ACCESS,
		),
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
	await expect(
		db.attachment.usageBytes(userA.username, FULL_ACCESS),
	).resolves.toBe(bytes.length);

	await db.attachment.create(
		{
			buffer: bytes,
			filename: "b.txt",
			uploaderId: userB.username,
			attachedTo: { type: "RESOURCE", id: resourceB.id },
		},
		FULL_ACCESS,
	);
	await expect(
		db.attachment.usageBytes(userA.username, FULL_ACCESS),
	).resolves.toBe(bytes.length);
	await expect(
		db.attachment.usageBytes(userB.username, FULL_ACCESS),
	).resolves.toBe(bytes.length);
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
	const usage = await db.attachment.usageBytes(student.username, FULL_ACCESS);
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
	await expect(
		db.attachment.usageBytes(student.username, FULL_ACCESS),
	).resolves.toBe(quota - 10);

	const tooBig = Buffer.from("x".repeat(20));
	const targetResource = await makeResource();
	await expect(
		db.attachment.create(
			{
				buffer: tooBig,
				filename: "over-quota.txt",
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

test("uploaderId sent by a non-SYSTEM caller is ignored: the actor is always recorded", async () => {
	const uploader = await makeUser("STUDENT");
	const impersonated = await makeUser("STUDENT");
	const resource = await makeResource();

	const attachment = await db.attachment.create(
		{
			buffer: Buffer.from(`forge ${tag("bytes")}`),
			filename: "forge.txt",
			uploaderId: impersonated.username,
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		{ actor: uploader },
	);

	expect(attachment.uploader?.username).toBe(uploader.username);
});

test("a SYSTEM call passing uploaderId explicitly still works", async () => {
	const uploader = await makeUser("STUDENT");
	const resource = await makeResource();

	const attachment = await db.attachment.create(
		{
			buffer: Buffer.from(`system-upload ${tag("bytes")}`),
			filename: "system-upload.txt",
			uploaderId: uploader.username,
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		FULL_ACCESS,
	);

	expect(attachment.uploader?.username).toBe(uploader.username);
});

//
// RESPONSE attachments: the quota counts only attempts that accept submissions,
// and `detachExcept` keeps (hash, name) pairs.
//

type Student = Awaited<ReturnType<typeof makeUser>>;

function studentQuota(): number {
	const quota = BLOB_QUOTA_BY_ROLE.STUDENT;
	if (quota === null) {
		throw new Error("test assumes STUDENT has a finite quota");
	}
	return quota;
}

/// An open attempt of `student` in the shared course.
async function makeAttempt(student: Student) {
	await db.enrollment
		.create({ course: sharedCourseId, username: student.username }, FULL_ACCESS)
		.catch(() => undefined);
	return persistedResponseFactory.create({
		course: sharedCourseId,
		author: student.username,
	});
}

/// A blob row with a fabricated size: the quota only reads `blob.size`.
async function fakeBlob(size: number): Promise<string> {
	const hash = hashOf(Buffer.from(`fake-blob ${tag("bytes")}`));
	await prisma.blob.create({ data: { hash, size } });
	return hash;
}

async function rawAttach(
	hash: string,
	filename: string,
	uploader: Student,
	owner: { type: "RESOURCE" | "RESPONSE" | "REPOSITORY"; id: number },
) {
	return prisma.attachment.create({
		data: {
			hash,
			filename,
			mimeType: "text/plain",
			uploaderId: uploader.username,
			attachedToType: owner.type,
			attachedToId: owner.id,
		},
	});
}

test("a RESPONSE file counts in the quota while the attempt is open, not once it is closed, and again after it is reopened", async () => {
	const student = await makeUser("STUDENT");
	const attempt = await makeAttempt(student);
	const resource = await makeResource();
	const base = 7;
	await rawAttach(await fakeBlob(base), "base.txt", student, {
		type: "RESOURCE",
		id: resource.id,
	});
	const extra = 100;
	await rawAttach(await fakeBlob(extra), "answer.txt", student, {
		type: "RESPONSE",
		id: attempt.id,
	});
	const usage = () => db.attachment.usageBytes(student.username, FULL_ACCESS);

	expect(await usage()).toBe(base + extra);

	await prisma.response.update({
		where: { id: attempt.id },
		data: { acceptingSubmissions: false },
	});
	expect(await usage()).toBe(base);

	await prisma.response.update({
		where: { id: attempt.id },
		data: { acceptingSubmissions: true },
	});
	expect(await usage()).toBe(base + extra);
});

test("a reopened attempt may exceed the quota: only new uploads are refused, and nothing already stored is touched", async () => {
	const student = await makeUser("STUDENT");
	const quota = studentQuota();
	const attempt = await makeAttempt(student);
	await prisma.response.update({
		where: { id: attempt.id },
		data: { acceptingSubmissions: false },
	});
	const hash = await fakeBlob(quota - 10);
	const row = await rawAttach(hash, "big.bin", student, {
		type: "RESPONSE",
		id: attempt.id,
	});

	// Closed: the 20 bytes fit, since the closed attempt is not charged.
	const resource = await makeResource();
	await db.attachment.create(
		{
			buffer: Buffer.from("y".repeat(20)),
			filename: "while-closed.txt",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		{ actor: student },
	);

	await expect(
		prisma.response.update({
			where: { id: attempt.id },
			data: { acceptingSubmissions: true },
		}),
	).resolves.toBeTruthy();
	expect(await db.attachment.usageBytes(student.username, FULL_ACCESS)).toBe(
		quota + 10,
	);
	await expect(
		db.attachment.assertWithinQuota(1, { actor: student }),
	).rejects.toBeInstanceOf(NotAllowed);
	expect(
		await prisma.attachment.findUnique({ where: { id: row.id } }),
	).not.toBeNull();
	expect(await prisma.blob.findUnique({ where: { hash } })).toMatchObject({
		deletedAt: null,
	});
});

test("usage counts every non-RESPONSE owner, and a closed Response sharing an id with a RESOURCE does not hide it", async () => {
	const student = await makeUser("STUDENT");
	const attempt = await makeAttempt(student);
	await prisma.response.update({
		where: { id: attempt.id },
		data: { acceptingSubmissions: false },
	});
	// Same numeric id as the closed attempt, but owned by a RESOURCE.
	await rawAttach(await fakeBlob(30), "same-id.txt", student, {
		type: "RESOURCE",
		id: attempt.id,
	});
	await rawAttach(await fakeBlob(12), "repo.txt", student, {
		type: "REPOSITORY",
		id: attempt.id,
	});

	expect(await db.attachment.usageBytes(student.username, FULL_ACCESS)).toBe(
		42,
	);
});

test("attaching the same hash and name to the same attempt twice charges once and returns the same row", async () => {
	const student = await makeUser("STUDENT");
	const quota = studentQuota();
	const attempt = await makeAttempt(student);
	const bytes = Buffer.from(`twice ${tag("bytes")}`);
	const blob = await db.blob.create({ bytes }, FULL_ACCESS);
	await prisma.blob.update({
		where: { hash: blob.hash },
		data: { size: quota - bytes.length },
	});
	const input = {
		hash: blob.hash,
		filename: "twice.txt",
		attachedTo: { type: "RESPONSE" as const, id: attempt.id },
	};

	const first = await db.attachment.attach(input, { actor: student });
	const usage = await db.attachment.usageBytes(student.username, FULL_ACCESS);
	const second = await db.attachment.attach(input, { actor: student });

	expect(second.id).toBe(first.id);
	expect(await db.attachment.usageBytes(student.username, FULL_ACCESS)).toBe(
		usage,
	);
});

test("attach with exactFilename stores a multi-dot name as given, and detachExcept matches it exactly", async () => {
	const student = await makeUser("STUDENT");
	const attempt = await makeAttempt(student);
	const owner = { type: "RESPONSE" as const, id: attempt.id };
	const blob = await db.blob.create(
		{ bytes: Buffer.from(`tarball ${tag("bytes")}`) },
		FULL_ACCESS,
	);

	const stored = await db.attachment.attach(
		{
			hash: blob.hash,
			filename: "x.tar.gz",
			attachedTo: owner,
			exactFilename: true,
		},
		{ actor: student },
	);
	expect(stored.filename).toBe("x.tar.gz");

	await db.attachment.detachExcept(
		owner,
		[{ hash: blob.hash, filename: "x.tar.gz" }],
		FULL_ACCESS,
	);
	expect(
		await prisma.attachment.count({
			where: { attachedToType: "RESPONSE", attachedToId: attempt.id },
		}),
	).toBe(1);
});

test("a student's file in an attempt is listed and found only by SYSTEM, never by another user", async () => {
	const author = await makeUser("STUDENT");
	const other = await makeUser("STUDENT");
	const attempt = await makeAttempt(author);
	const blob = await db.blob.create(
		{ bytes: Buffer.from(`secret ${tag("bytes")}`) },
		FULL_ACCESS,
	);
	const row = await db.attachment.attach(
		{
			hash: blob.hash,
			filename: "answer.pdf",
			attachedTo: { type: "RESPONSE", id: attempt.id },
		},
		{ actor: author },
	);

	for (const actor of [other, author]) {
		const listed = await db.attachment.findMany(
			{ uploader: author.username },
			{ actor },
		);
		expect(JSON.stringify(listed)).not.toContain(blob.hash);
		expect(await db.attachment.findOne({ id: row.id }, { actor })).toBeNull();
	}
	expect(
		await db.attachment.findOne({ id: row.id }, { actor: SYSTEM }),
	).toMatchObject({ hash: blob.hash });
});

async function twoHashesOneName() {
	const student = await makeUser("STUDENT");
	const attempt = await makeAttempt(student);
	const owner = { type: "RESPONSE" as const, id: attempt.id };
	const blobs = {
		a: Buffer.from(`blob-a ${tag("bytes")}`),
		b: Buffer.from(`blob-b ${tag("bytes")}`),
		c: Buffer.from(`blob-c ${tag("bytes")}`),
	};
	const stored = {
		a: await db.blob.create({ bytes: blobs.a }, FULL_ACCESS),
		b: await db.blob.create({ bytes: blobs.b }, FULL_ACCESS),
		c: await db.blob.create({ bytes: blobs.c }, FULL_ACCESS),
	};
	const mine = (hash: string, filename: string) =>
		db.attachment.attach(
			{ hash, filename, attachedTo: owner },
			{ actor: SYSTEM },
		);
	await mine(stored.a.hash, "relatorio.pdf");
	await mine(stored.b.hash, "relatorio.pdf");
	await mine(stored.c.hash, "notas.txt");
	return { owner, blobs, stored };
}

test("detachExcept keeps one name under two hashes and removes only the pairs not listed", async () => {
	const { owner, blobs, stored } = await twoHashesOneName();
	const otherResource = await makeResource();
	await db.attachment.attach(
		{
			hash: stored.a.hash,
			filename: "relatorio.pdf",
			attachedTo: { type: "RESOURCE", id: otherResource.id },
		},
		FULL_ACCESS,
	);
	const path = (hash: string, name: string) =>
		db.blob.attachmentPath(hash, name);

	await db.attachment.detachExcept(
		owner,
		[
			{ hash: stored.a.hash, filename: "relatorio.pdf" },
			{ hash: stored.b.hash, filename: "relatorio.pdf" },
		],
		FULL_ACCESS,
	);

	const left = await prisma.attachment.findMany({
		where: { attachedToType: "RESPONSE", attachedToId: owner.id },
	});
	expect(left.map((row) => row.hash).sort()).toEqual(
		[stored.a.hash, stored.b.hash].sort(),
	);
	expect(readFileSync(path(stored.a.hash, "relatorio.pdf"))).toEqual(blobs.a);
	// A response's file has no name beside its bytes; only the resource's does.
	expect(existsSync(path(stored.b.hash, "relatorio.pdf"))).toBe(false);
	expect(readFileSync(db.blob.blobPath(stored.b.hash))).toEqual(blobs.b);
	expect(existsSync(path(stored.c.hash, "notas.txt"))).toBe(false);

	await db.attachment.detachExcept(
		owner,
		[{ hash: stored.a.hash, filename: "relatorio.pdf" }],
		FULL_ACCESS,
	);
	const rest = await prisma.attachment.findMany({
		where: { attachedToType: "RESPONSE", attachedToId: owner.id },
	});
	expect(rest.map((row) => row.hash)).toEqual([stored.a.hash]);
	expect(readFileSync(path(stored.a.hash, "relatorio.pdf"))).toEqual(blobs.a);

	// Another owner holding the same (hash, name) is untouched.
	expect(
		await prisma.attachment.count({
			where: {
				attachedToType: "RESOURCE",
				attachedToId: otherResource.id,
				hash: stored.a.hash,
			},
		}),
	).toBe(1);
});

test("detachExcept tombstones nothing; the garbage collector collects the unattached blob later and spares the kept ones", async () => {
	const { owner, blobs, stored } = await twoHashesOneName();

	await db.attachment.detachExcept(
		owner,
		[
			{ hash: stored.a.hash, filename: "relatorio.pdf" },
			{ hash: stored.b.hash, filename: "relatorio.pdf" },
		],
		FULL_ACCESS,
	);

	const before = await prisma.blob.findUniqueOrThrow({
		where: { hash: stored.c.hash },
	});
	expect(before.deletedAt).toBeNull();
	expect(await db.blob.readBlob(before)).toEqual(blobs.c);

	const collected = await db.blob.collectGarbage({
		actor: SYSTEM,
		olderThan: new Date(Date.now() + 60_000),
	});
	expect(collected).toContain(stored.c.hash);
	expect(collected).not.toContain(stored.a.hash);
	expect(collected).not.toContain(stored.b.hash);
	expect(
		(await prisma.blob.findUniqueOrThrow({ where: { hash: stored.c.hash } }))
			.deletedAt,
	).not.toBeNull();
});

test("G1: a RESPONSE attachment never links its name; a sibling of another owner keeps its own link through removal on both sides", async () => {
	const student = await makeUser("STUDENT");
	const attempt = await makeAttempt(student);
	const resource = await makeResource();
	const bytes = Buffer.from(`g1 ${tag("bytes")}`);
	const stored = await db.blob.storeBytes(bytes, { actor: SYSTEM });
	const owner = { type: "RESPONSE" as const, id: attempt.id };
	const linkPath = db.blob.attachmentPath(stored.hash, "same.txt");

	const mine = await db.attachment.attach(
		{
			hash: stored.hash,
			filename: "same.txt",
			attachedTo: owner,
			uploaderId: student.username,
		},
		{ actor: SYSTEM },
	);
	expect(existsSync(linkPath)).toBe(false);

	const shared = await db.attachment.attach(
		{
			hash: stored.hash,
			filename: "same.txt",
			attachedTo: { type: "RESOURCE", id: resource.id },
		},
		{ actor: SYSTEM },
	);
	expect(existsSync(linkPath)).toBe(true);

	// Removing the response's use must not unlink the resource's name.
	await db.attachment.detach("RESPONSE", attempt.id, { actor: SYSTEM });
	expect(existsSync(linkPath)).toBe(true);

	// A response sibling of the same name must not keep a link alive.
	await db.attachment.attach(
		{ hash: stored.hash, filename: "same.txt", attachedTo: owner },
		{ actor: SYSTEM },
	);
	await db.attachment.delete({ id: shared.id }, FULL_ACCESS);
	expect(existsSync(linkPath)).toBe(false);
	await db.attachment.delete({ id: mine.id }, FULL_ACCESS);
});
