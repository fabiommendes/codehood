import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/db/base-service";
import { courseService } from "@/db/course.service";
import { disciplineService } from "@/db/discipline.service";
import { editionService } from "@/db/edition.service";
import { fileService } from "@/db/file.service";
import { groupResourcesByType, resourceService } from "@/db/resource.service";
import { userService } from "@/db/user.service";

// A random suffix, not an incrementing counter: this file's own `tag()`
// numbering would otherwise collide with the identically-named counters in
// sibling spec files (e.g. course-service.spec.ts's `instructor1`), since
// they all share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
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

async function makeFile() {
	return fileService.create(
		{ bytes: Buffer.from(`bytes ${tag("f")}`), mimeType: "application/pdf" },
		FULL_ACCESS,
	);
}

test("each type's shape rule: LINK without data, FILE without fileId, CODE without extra, and MD with a fileId are all refused", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);
	const file = await makeFile();
	const opts = { actor: instructor };

	await expect(
		resourceService.create(
			{
				courseId: course.id,
				slug: "a",
				type: "LINK",
				title: "t",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		resourceService.create(
			{
				courseId: course.id,
				slug: "b",
				type: "FILE",
				title: "t",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		resourceService.create(
			{
				courseId: course.id,
				slug: "c",
				type: "CODE",
				title: "t",
				data: "print(1)",
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();

	await expect(
		resourceService.create(
			{
				courseId: course.id,
				slug: "d",
				type: "MD",
				title: "t",
				data: "# hi",
				fileId: file.id,
				contentHash: tag("h"),
			},
			opts,
		),
	).rejects.toThrow();
});

test("create rejects a duplicate slug in one course, and accepts the same slug in another", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);

	await resourceService.create(
		{
			courseId: courseA.id,
			slug: "syllabus",
			type: "LINK",
			title: "Syllabus",
			data: "https://example.com/a",
			contentHash: tag("h"),
		},
		{ actor: instructor },
	);

	await expect(
		resourceService.create(
			{
				courseId: courseA.id,
				slug: "syllabus",
				type: "LINK",
				title: "Syllabus again",
				data: "https://example.com/b",
				contentHash: tag("h"),
			},
			{ actor: instructor },
		),
	).rejects.toThrow();

	await expect(
		resourceService.create(
			{
				courseId: courseB.id,
				slug: "syllabus",
				type: "LINK",
				title: "Syllabus",
				data: "https://example.com/c",
				contentHash: tag("h"),
			},
			{ actor: instructor },
		),
	).resolves.toMatchObject({ slug: "syllabus" });
});

test("create rejects a missing contentHash and stores a supplied one verbatim", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const course = await makeCourse(instructor.username);

	await expect(
		resourceService.create(
			{
				courseId: course.id,
				slug: "no-hash",
				type: "LINK",
				title: "t",
				data: "https://example.com",
				contentHash: "",
			},
			{ actor: instructor },
		),
	).rejects.toThrow();

	const hash = tag("verbatim-hash");
	const resource = await resourceService.create(
		{
			courseId: course.id,
			slug: "with-hash",
			type: "LINK",
			title: "t",
			data: "https://example.com",
			contentHash: hash,
		},
		{ actor: instructor },
	);
	expect(resource.contentHash).toBe(hash);
});

test("groupResourcesByType: fixed type order (Files, Links, Notes, Snippets), title order within each, empty groups absent", () => {
	const base = {
		id: 0,
		courseId: 1,
		description: null,
		extra: null,
		fileId: null,
		file: null,
		contentHash: "h",
		createdAt: new Date(),
		updatedAt: new Date(),
		slug: "s",
	};
	const resources = [
		{
			...base,
			id: 1,
			type: "CODE" as const,
			title: "Zebra.py",
			data: "1",
			slug: "zebra",
		},
		{
			...base,
			id: 2,
			type: "LINK" as const,
			title: "Beta link",
			data: "https://a",
			slug: "beta",
		},
		{
			...base,
			id: 3,
			type: "LINK" as const,
			title: "Alpha link",
			data: "https://b",
			slug: "alpha",
		},
		{
			...base,
			id: 4,
			type: "MD" as const,
			title: "Notes",
			data: "# hi",
			slug: "notes",
		},
	];

	const groups = groupResourcesByType(resources);
	expect(groups.map((g) => g.type)).toEqual(["LINK", "MD", "CODE"]); // FILE group absent: empty
	expect(
		groups.find((g) => g.type === "LINK")?.resources.map((r) => r.title),
	).toEqual(["Alpha link", "Beta link"]);

	// Reproducible: same input, same output, every time.
	expect(groupResourcesByType(resources)).toEqual(groups);
});

test("an enrolled student sees a course's resources; a dropped student sees none; a non-owning admin reads but cannot write", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const admin = await makeUser("ADMIN");
	const active = await makeUser("STUDENT");
	const dropped = await makeUser("STUDENT");
	const course = await makeCourse(instructor.username);

	await courseService.enroll(
		{ courseId: course.id, userId: active.id },
		FULL_ACCESS,
	);
	await courseService.enroll(
		{ courseId: course.id, userId: dropped.id },
		FULL_ACCESS,
	);
	await courseService.unenroll(
		{ courseId: course.id, userId: dropped.id },
		FULL_ACCESS,
	);

	await resourceService.create(
		{
			courseId: course.id,
			slug: "syllabus",
			type: "LINK",
			title: "Syllabus",
			data: "https://example.com",
			contentHash: tag("h"),
		},
		{ actor: instructor },
	);

	await expect(
		resourceService.findMany({ courseId: course.id }, { actor: active }),
	).resolves.toHaveLength(1);
	await expect(
		resourceService.findMany({ courseId: course.id }, { actor: dropped }),
	).resolves.toHaveLength(0);
	await expect(
		resourceService.findMany({ courseId: course.id }, { actor: admin }),
	).resolves.toHaveLength(1);

	await expect(
		resourceService.create(
			{
				courseId: course.id,
				slug: "admin-attempt",
				type: "LINK",
				title: "t",
				data: "https://example.com",
				contentHash: tag("h"),
			},
			{ actor: admin },
		),
	).rejects.toThrow();
});

test("delete removes the resource row; the File it pointed at survives, because another resource may still point at it", async () => {
	const instructor = await makeUser("INSTRUCTOR");
	const courseA = await makeCourse(instructor.username);
	const courseB = await makeCourse(instructor.username);
	const file = await makeFile();

	const resourceA = await resourceService.create(
		{
			courseId: courseA.id,
			slug: "shared",
			type: "FILE",
			title: "Shared file",
			fileId: file.id,
			contentHash: tag("h"),
		},
		{ actor: instructor },
	);
	await resourceService.create(
		{
			courseId: courseB.id,
			slug: "shared",
			type: "FILE",
			title: "Shared file",
			fileId: file.id,
			contentHash: tag("h"),
		},
		{ actor: instructor },
	);

	await resourceService.delete({ id: resourceA.id }, { actor: instructor });

	await expect(
		resourceService.findOne({ id: resourceA.id }, { actor: instructor }),
	).resolves.toBeNull();
	const survivor = await fileService.findOne({ id: file.id }, FULL_ACCESS);
	expect(survivor?.deletedAt).toBeNull();
});
