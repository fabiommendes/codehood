import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/db/base-service";
import { courseService } from "@/db/course.service";
import { disciplineService } from "@/db/discipline.service";
import { editionService } from "@/db/edition.service";
import { blobPath, fileService } from "@/db/file.service";
import { resourceService } from "@/db/resource.service";
import { userService } from "@/db/user.service";

// A random suffix, not an incrementing counter: this file's own `tag()`
// numbering would otherwise collide with the identically-named counters in
// sibling spec files (e.g. course-service.spec.ts's `instructor1`), since
// they all share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function hashOf(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function makeInstructor() {
	const username = tag("instructor");
	return userService.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role: "INSTRUCTOR",
			password: "x",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function ensureEdition(slug = "2026-1"): Promise<string> {
	if (!(await editionService.findOne({ slug }))) {
		await editionService.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

async function makeCourse(instructorUsername: string) {
	const disciplineSlug = tag("disc");
	await disciplineService.create(
		{ slug: disciplineSlug, name: disciplineSlug },
		FULL_ACCESS,
	);
	await ensureEdition();
	return courseService.create(
		{
			disciplineSlug,
			instructorUsername,
			editionSlug: "2026-1",
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
}

test("two uploads of identical bytes produce one row and one file on disk; two resources from different courses may point at it", async () => {
	const bytes = Buffer.from(`hello world ${tag("bytes")}`);
	const hash = hashOf(bytes);

	const first = await fileService.create(
		{ bytes, mimeType: "text/plain" },
		FULL_ACCESS,
	);
	const second = await fileService.create(
		{ bytes, mimeType: "text/plain" },
		FULL_ACCESS,
	);
	expect(second.id).toBe(first.id);
	expect(second.slugHash).toBe(hash);
	expect(existsSync(blobPath(hash))).toBe(true);

	const instructorA = await makeInstructor();
	const instructorB = await makeInstructor();
	const courseA = await makeCourse(instructorA.username);
	const courseB = await makeCourse(instructorB.username);

	await resourceService.create(
		{
			courseId: courseA.id,
			slug: "shared-file",
			type: "FILE",
			title: "Shared file",
			fileId: first.id,
			contentHash: tag("hash"),
		},
		{ actor: instructorA },
	);
	await resourceService.create(
		{
			courseId: courseB.id,
			slug: "shared-file",
			type: "FILE",
			title: "Shared file",
			fileId: first.id,
			contentHash: tag("hash"),
		},
		{ actor: instructorB },
	);

	const found = await fileService.findOne({ slugHash: hash }, FULL_ACCESS);
	expect(found?.id).toBe(first.id);
});

test("a CLI-supplied hash that disagrees with the bytes is rejected as corrupt", async () => {
	const bytes = Buffer.from(`corrupt-me ${tag("bytes")}`);
	await expect(
		fileService.create(
			{ bytes, mimeType: "text/plain", contentHash: "not-the-real-hash" },
			FULL_ACCESS,
		),
	).rejects.toThrow();
});

test("only SYSTEM may create, update, or delete a file", async () => {
	const actor = await makeInstructor();
	const bytes = Buffer.from(`system-only ${tag("bytes")}`);
	await expect(
		fileService.create({ bytes, mimeType: "text/plain" }, { actor }),
	).rejects.toThrow();

	const file = await fileService.create(
		{ bytes, mimeType: "text/plain" },
		FULL_ACCESS,
	);
	await expect(
		fileService.update(
			{ slugHash: file.slugHash },
			{ mimeType: "text/csv" },
			{ actor },
		),
	).rejects.toThrow();
	await expect(
		fileService.delete({ slugHash: file.slugHash }, { actor }),
	).rejects.toThrow();
});

test("the stored path is derived from slugHash alone — no request field reaches it, asserted with a title containing '../'", async () => {
	const bytes = Buffer.from(`path-traversal-check ${tag("bytes")}`);
	const hash = hashOf(bytes);
	const file = await fileService.create(
		{ bytes, mimeType: "text/plain" },
		FULL_ACCESS,
	);

	const instructor = await makeInstructor();
	const course = await makeCourse(instructor.username);
	await resourceService.create(
		{
			courseId: course.id,
			slug: "traversal",
			type: "FILE",
			title: "../../../etc/passwd",
			fileId: file.id,
			contentHash: tag("hash"),
		},
		{ actor: instructor },
	);

	expect(blobPath(hash)).toBe(blobPath(file.slugHash));
	expect(blobPath(hash)).not.toContain("etc");
	expect(blobPath(hash).endsWith(hash)).toBe(true);
});

test("delete on a blob with two references removes neither bytes nor row; removing the second reference removes bytes, keeps the row, and stamps deletedAt", async () => {
	const bytes = Buffer.from(`ref-counted ${tag("bytes")}`);
	const file = await fileService.create(
		{ bytes, mimeType: "text/plain" },
		FULL_ACCESS,
	);
	const path = blobPath(file.slugHash);

	const instructorA = await makeInstructor();
	const instructorB = await makeInstructor();
	const courseA = await makeCourse(instructorA.username);
	const courseB = await makeCourse(instructorB.username);

	const resourceA = await resourceService.create(
		{
			courseId: courseA.id,
			slug: "r",
			type: "FILE",
			title: "Copy A",
			fileId: file.id,
			contentHash: tag("hash"),
		},
		{ actor: instructorA },
	);
	const resourceB = await resourceService.create(
		{
			courseId: courseB.id,
			slug: "r",
			type: "FILE",
			title: "Copy B",
			fileId: file.id,
			contentHash: tag("hash"),
		},
		{ actor: instructorB },
	);

	await resourceService.delete({ id: resourceA.id }, { actor: instructorA });
	expect(existsSync(path)).toBe(true);
	let current = await fileService.findOne(
		{ slugHash: file.slugHash },
		FULL_ACCESS,
	);
	expect(current?.deletedAt).toBeNull();

	await resourceService.delete({ id: resourceB.id }, { actor: instructorB });
	expect(existsSync(path)).toBe(false);
	current = await fileService.findOne({ slugHash: file.slugHash }, FULL_ACCESS);
	expect(current).not.toBeNull();
	expect(current?.deletedAt).not.toBeNull();
});

test("blob route: application/pdf, image/png, audio/mpeg, video/mp4 are inline; text/html, image/svg+xml, and an unknown type are attachment; all carry nosniff", async ({
	request,
}) => {
	const inlineTypes = [
		"application/pdf",
		"image/png",
		"audio/mpeg",
		"video/mp4",
	];
	const attachmentTypes = ["text/html", "image/svg+xml", "application/x-thing"];

	for (const mimeType of [...inlineTypes, ...attachmentTypes]) {
		const bytes = Buffer.from(`content for ${mimeType} ${tag("bytes")}`);
		const file = await fileService.create({ bytes, mimeType }, FULL_ACCESS);

		const res = await request.get(`/files/${file.slugHash}`);
		expect(res.status()).toBe(200);
		expect(res.headers()["x-content-type-options"]).toBe("nosniff");
		const disposition = res.headers()["content-disposition"] ?? "";
		if (inlineTypes.includes(mimeType)) {
			expect(disposition.startsWith("inline")).toBe(true);
		} else {
			expect(disposition.startsWith("attachment")).toBe(true);
		}
	}
});

test("blob route: the download name comes from the linking resource's title, and a shared blob downloads under whichever one was clicked", async ({
	request,
}) => {
	const bytes = Buffer.from(`shared-name ${tag("bytes")}`);
	const file = await fileService.create(
		{ bytes, mimeType: "application/pdf" },
		FULL_ACCESS,
	);

	const instructorA = await makeInstructor();
	const instructorB = await makeInstructor();
	const courseA = await makeCourse(instructorA.username);
	const courseB = await makeCourse(instructorB.username);
	await resourceService.create(
		{
			courseId: courseA.id,
			slug: "r",
			type: "FILE",
			title: "Slides 01",
			fileId: file.id,
			contentHash: tag("hash"),
		},
		{ actor: instructorA },
	);
	await resourceService.create(
		{
			courseId: courseB.id,
			slug: "r",
			type: "FILE",
			title: "Syllabus",
			fileId: file.id,
			contentHash: tag("hash"),
		},
		{ actor: instructorB },
	);

	const asSlides = await request.get(`/files/${file.slugHash}/slides-01.pdf`);
	expect(asSlides.headers()["content-disposition"]).toContain("slides-01.pdf");

	const asSyllabus = await request.get(`/files/${file.slugHash}/syllabus.pdf`);
	expect(asSyllabus.headers()["content-disposition"]).toContain("syllabus.pdf");
});

test("blob route: a tombstoned file resolves to 410 and explains itself, and an unknown token resolves to 404", async ({
	request,
}) => {
	const notFound = await request.get(`/files/${"0".repeat(64)}`);
	expect(notFound.status()).toBe(404);

	// ResourceService.delete removes the referencing row outright (matching
	// FR-SYNC-013's "deleted" row for calendar events), so by the time the
	// last reference is gone and the File tombstones, there is no longer a
	// Resource row left to name — see the resolution of this in the
	// implementation report for `dev/specs/to-do/resources.md`. The 410 page
	// still has to explain itself (FR-SYNC-015) rather than 404, generically
	// when it has nothing to name.
	const bytes = Buffer.from(`will-be-tombstoned ${tag("bytes")}`);
	const file = await fileService.create(
		{ bytes, mimeType: "text/plain" },
		FULL_ACCESS,
	);
	const instructor = await makeInstructor();
	const course = await makeCourse(instructor.username);
	const resource = await resourceService.create(
		{
			courseId: course.id,
			slug: "r",
			type: "FILE",
			title: "Handout",
			fileId: file.id,
			contentHash: tag("hash"),
		},
		{ actor: instructor },
	);
	await resourceService.delete({ id: resource.id }, { actor: instructor });

	const tombstoned = await request.get(`/files/${file.slugHash}`);
	expect(tombstoned.status()).toBe(410);
	expect(tombstoned.headers()["x-content-type-options"]).toBe("nosniff");
	expect(await tombstoned.text()).toContain("removed");
});
