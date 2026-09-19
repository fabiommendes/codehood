import { expect, test } from "@playwright/test";
import type { z } from "zod";
import { type Actor, FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import type { questionSchema } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import type { Question, QuestionPublic } from "@/db/services/question.service";
import { persistedUserFactory } from "@/fixtures/user.factory";
import type { PublicQuestion } from "@/mdq/public";

type Doc = z.infer<typeof questionSchema>["question"];

const multipleChoice: Doc = {
	type: "multiple-choice",
	title: "Recursion basics",
	stem: "What makes a recursive function terminate?",
	tags: ["recursion", "functions"],
	choices: [
		{ id: "base-case", text: "A base case", score: 1 },
		{ id: "tail-call", text: "A tail call" },
	],
};

// The edition factory's slugs come from a short sequence and collide with the
// ones sibling spec files draw, so this file provisions its own by hand.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2026-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
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

async function makeCourse() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const discipline = tag("disc");
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	const course = await db.course.create(
		{
			discipline,
			instructor: instructor.username,
			edition: await ensureEdition(),
			startAt: new Date("2026-01-01"),
			endAt: new Date("2026-05-01"),
		},
		FULL_ACCESS,
	);
	return { course, opts: { actor: instructor } };
}

test("create() stores the question with its first version", async () => {
	const { course, opts } = await makeCourse();

	const question = await db.question.create(
		{
			courseId: course.id,
			slug: "recursion-basics",
			status: "PUBLISHED",
			version: "v1",
			question: multipleChoice,
		},
		opts,
	);

	expect(question.slug).toBe("recursion-basics");
	expect(question.status).toBe("PUBLISHED");
	expect(question.version).toBe("v1");
	expect(question.question).toEqual(multipleChoice);

	const row = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: course.id, slug: "recursion-basics" },
		include: { versions: true, questionTags: true },
	});
	expect(row.type).toBe("MULTIPLE_CHOICE");
	expect(row.publicId.length).toBeGreaterThan(0);
	expect(row.versions).toHaveLength(1);
	expect(row.latestId).toBe(row.versions[0]?.id);
	expect(row.versions[0]?.title).toBe("Recursion basics");

	// The halves are stored apart, so a student-facing read can select the
	// public column alone.
	const version = row.versions[0];
	expect(JSON.stringify(version?.publicPayload)).not.toContain('"score"');
	expect(JSON.stringify(version?.privatePayload)).toContain('"score"');
	expect(row.questionTags.map((t) => t.tag).sort()).toEqual([
		"functions",
		"recursion",
	]);
});

test("create() titles an untitled question after its slug", async () => {
	const { course, opts } = await makeCourse();
	const { title: _title, ...untitled } = multipleChoice;

	await db.question.create(
		{
			courseId: course.id,
			slug: "untitled-one",
			status: "DRAFT",
			version: "v1",
			question: untitled,
		},
		opts,
	);

	const row = await prisma.questionData.findFirstOrThrow({
		where: { ref: { courseId: course.id, slug: "untitled-one" } },
	});
	expect(row.title).toBe("untitled-one");
});

test("create() accepts the course's natural key in place of its id", async () => {
	const { course, opts } = await makeCourse();

	const question = await db.question.create(
		{
			courseId: {
				discipline: course.discipline.slug,
				instructor: course.instructor.username,
				edition: course.edition.slug,
			},
			slug: "by-natural-key",
			status: "DRAFT",
			version: "v1",
			question: multipleChoice,
		},
		opts,
	);

	expect(question.slug).toBe("by-natural-key");
});

test("create() refuses an instructor who does not own the course", async () => {
	const { course } = await makeCourse();
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });

	await expect(
		db.question.create(
			{
				courseId: course.id,
				slug: "not-mine",
				status: "DRAFT",
				version: "v1",
				question: multipleChoice,
			},
			{ actor: stranger },
		),
	).rejects.toThrow();

	expect(await prisma.questionRef.count({ where: { slug: "not-mine" } })).toBe(
		0,
	);
});

test("create() refuses a document whose fields disagree, and writes nothing", async () => {
	const { course, opts } = await makeCourse();

	await expect(
		db.question.create(
			{
				courseId: course.id,
				slug: "broken-fill-in",
				status: "DRAFT",
				version: "v1",
				// The stem references no blank, so `capital` is defined and never asked.
				question: {
					type: "fill-in",
					stem: "The capital of Brazil is a city.",
					blanks: [
						{ id: "capital", type: "short-answer", oneOf: ["Brasilia"] },
					],
				},
			},
			opts,
		),
	).rejects.toThrow();

	expect(
		await prisma.questionRef.count({ where: { courseId: course.id } }),
	).toBe(0);
});

test("create() refuses a second question with the same slug in one course", async () => {
	const { course, opts } = await makeCourse();
	const input = {
		courseId: course.id,
		slug: "same-slug",
		status: "DRAFT" as const,
		version: "v1",
		question: multipleChoice,
	};

	await db.question.create(input, opts);
	await expect(db.question.create(input, opts)).rejects.toThrow();
});

test("create() allows the same slug in a different course", async () => {
	const first = await makeCourse();
	const second = await makeCourse();

	for (const { course, opts } of [first, second]) {
		await db.question.create(
			{
				courseId: course.id,
				slug: "shared-slug",
				status: "DRAFT",
				version: "v1",
				question: multipleChoice,
			},
			opts,
		);
	}

	expect(
		await prisma.questionRef.count({ where: { slug: "shared-slug" } }),
	).toBe(2);
});

const trueFalse: Doc = {
	type: "true-false",
	stem: "Judge each statement.",
	choices: [
		{ id: "s0", text: "Statement 0", correct: true },
		{ id: "s1", text: "Statement 1", correct: false },
	],
};

test("findMany() lists only the questions of the requested course, by id or by natural key", async () => {
	const { course, opts } = await makeCourse();
	const other = await makeCourse();

	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: multipleChoice,
		},
		opts,
	);
	await db.question.create(
		{
			courseId: course.id,
			slug: "q2",
			status: "PUBLISHED",
			version: "v1",
			question: trueFalse,
		},
		opts,
	);
	await db.question.create(
		{
			courseId: other.course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: multipleChoice,
		},
		other.opts,
	);

	const byId = await db.question.findMany({ courseId: course.id }, opts);
	expect(byId.map((q) => q.slug).sort()).toEqual(["q1", "q2"]);

	const byNaturalKey = await db.question.findMany(
		{
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		},
		opts,
	);
	expect(byNaturalKey.map((q) => q.slug).sort()).toEqual(["q1", "q2"]);
});

test("findMany() gives the instructor the full document, including private fields", async () => {
	const { course, opts } = await makeCourse();
	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: trueFalse,
		},
		opts,
	);

	const questions = await db.question.findMany({ courseId: course.id }, opts);

	expect(questions).toHaveLength(1);
	const [question] = questions as [z.infer<typeof questionSchema>];
	expect(
		(question.question as Doc & { type: "true-false" }).choices[0],
	).toHaveProperty("correct");
});

test("findMany() gives an enrolled student only the public half", async () => {
	const { course, opts } = await makeCourse();
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: trueFalse,
		},
		opts,
	);

	const questions = await db.question.findMany(
		{ courseId: course.id },
		{ actor: student },
	);

	expect(questions).toHaveLength(1);
	const publicQuestion = questions[0]?.question as PublicQuestion & {
		type: "true-false";
	};
	expect(publicQuestion.choices[0]).not.toHaveProperty("correct");
});

test("findMany() refuses an actor with no visibility into the course", async () => {
	const { course, opts } = await makeCourse();
	const stranger = await persistedUserFactory.create({ role: "STUDENT" });
	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: multipleChoice,
		},
		opts,
	);

	await expect(
		db.question.findMany({ courseId: course.id }, { actor: stranger }),
	).rejects.toThrow();
});

test("findMany() narrows by slugs and by status", async () => {
	const { course, opts } = await makeCourse();
	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: multipleChoice,
		},
		opts,
	);
	await db.question.create(
		{
			courseId: course.id,
			slug: "q2",
			status: "DRAFT",
			version: "v1",
			question: trueFalse,
		},
		opts,
	);

	const bySlug = await db.question.findMany(
		{ courseId: course.id, slugs: ["q1"] },
		opts,
	);
	expect(bySlug.map((q) => q.slug)).toEqual(["q1"]);

	const byStatus = await db.question.findMany(
		{ courseId: course.id, statuses: ["DRAFT"] },
		opts,
	);
	expect(byStatus.map((q) => q.slug)).toEqual(["q2"]);
});

//
// update / upsert / delete
//

async function seedQuestion(
	status: "DRAFT" | "PUBLISHED" | "ARCHIVED" = "PUBLISHED",
) {
	const ctx = await makeCourse();
	await db.question.create(
		{
			courseId: ctx.course.id,
			slug: "q1",
			status,
			version: "v1",
			question: multipleChoice,
		},
		ctx.opts,
	);
	const pk = { courseId: ctx.course.id, slug: "q1" };
	return { ...ctx, pk };
}

function versionsOf(courseId: number, slug = "q1") {
	return prisma.questionData.findMany({
		where: { ref: { courseId, slug } },
		orderBy: { id: "asc" },
	});
}

const edited: Doc = {
	...multipleChoice,
	stem: "Which of these guarantees termination?",
	tags: ["recursion"],
};

test("update() appends a version, repoints latest, and leaves the old version untouched", async () => {
	const { course, opts, pk } = await seedQuestion();
	const [before] = await versionsOf(course.id);

	const question = await db.question.update(
		pk,
		{ version: "v2", question: edited },
		opts,
	);

	expect(question.version).toBe("v2");
	expect(question.question.stem).toBe(edited.stem);

	const versions = await versionsOf(course.id);
	expect(versions.map((v) => v.versionHash)).toEqual(["v1", "v2"]);
	expect(versions[0]).toEqual(before);

	const ref = await prisma.questionRef.findFirstOrThrow({
		where: pk,
		include: { questionTags: true },
	});
	expect(ref.latestId).toBe(versions[1]?.id);
	expect(ref.questionTags.map((t) => t.tag)).toEqual(["recursion"]);
});

test("update() changes the type when the new document declares another", async () => {
	const { course, opts, pk } = await seedQuestion();

	await db.question.update(pk, { version: "v2", question: trueFalse }, opts);

	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: course.id, slug: "q1" },
	});
	expect(ref.type).toBe("TRUE_FALSE");
});

test("update() with only a status creates no version", async () => {
	const { course, opts, pk } = await seedQuestion("DRAFT");

	const question = await db.question.update(pk, { status: "PUBLISHED" }, opts);

	expect(question.status).toBe("PUBLISHED");
	expect(question.version).toBe("v1");
	expect(await versionsOf(course.id)).toHaveLength(1);
});

test("update() reusing a hash with the same content repoints latest to that version", async () => {
	const { course, opts, pk } = await seedQuestion();
	await db.question.update(pk, { version: "v2", question: edited }, opts);

	const question = await db.question.update(
		pk,
		{ version: "v1", question: multipleChoice },
		opts,
	);

	expect(question.version).toBe("v1");
	expect(question.question.stem).toBe(multipleChoice.stem);
	expect(await versionsOf(course.id)).toHaveLength(2);
});

test("update() refuses a known hash with different content, and writes nothing", async () => {
	const { course, opts, pk } = await seedQuestion();

	await expect(
		db.question.update(pk, { version: "v1", question: edited }, opts),
	).rejects.toMatchObject({ status: 409 });

	const versions = await versionsOf(course.id);
	expect(versions).toHaveLength(1);
	expect(versions[0]?.stem).toBe(multipleChoice.stem);
});

test("update() refuses a document without a version label", async () => {
	const { opts, pk } = await seedQuestion();

	await expect(
		db.question.update(pk, { question: edited }, opts),
	).rejects.toThrow();
});

test("update() refuses a document whose fields disagree, and writes nothing", async () => {
	const { course, opts, pk } = await seedQuestion();

	await expect(
		db.question.update(
			pk,
			{
				version: "v2",
				question: {
					type: "fill-in",
					stem: "The capital of Brazil is a city.",
					blanks: [
						{ id: "capital", type: "short-answer", oneOf: ["Brasilia"] },
					],
				},
			},
			opts,
		),
	).rejects.toThrow();

	expect(await versionsOf(course.id)).toHaveLength(1);
});

test("update() refuses an instructor who does not own the course", async () => {
	const { course, pk } = await seedQuestion();
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });

	await expect(
		db.question.update(
			pk,
			{ version: "v2", question: edited },
			{ actor: stranger },
		),
	).rejects.toThrow();
	expect(await versionsOf(course.id)).toHaveLength(1);
});

test("update() refuses an admin who does not teach the course", async () => {
	const { course, pk } = await seedQuestion();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });

	await expect(
		db.question.update(pk, { status: "DRAFT" }, { actor: admin }),
	).rejects.toThrow();
	expect(
		(await prisma.questionRef.findFirstOrThrow({ where: pk })).status,
	).toBe("PUBLISHED");
	expect(await versionsOf(course.id)).toHaveLength(1);
});

test("update() refuses a missing question", async () => {
	const { course, opts } = await seedQuestion();

	await expect(
		db.question.update(
			{ courseId: course.id, slug: "nope" },
			{ status: "DRAFT" },
			opts,
		),
	).rejects.toThrow();
});

test("upsert() creates the question when absent and appends a version when present", async () => {
	const { course, opts } = await makeCourse();
	const input = {
		courseId: course.id,
		slug: "q1",
		status: "DRAFT" as const,
		version: "v1",
		question: multipleChoice,
	};

	const created = await db.question.upsert(input, opts);
	expect(created.version).toBe("v1");

	const updated = await db.question.upsert(
		{ ...input, status: "PUBLISHED", version: "v2", question: edited },
		opts,
	);
	expect(updated.version).toBe("v2");
	expect(updated.status).toBe("PUBLISHED");
	expect(await versionsOf(course.id)).toHaveLength(2);
});

test("upsert() with the same payload twice is idempotent", async () => {
	const { course, opts } = await makeCourse();
	const input = {
		courseId: course.id,
		slug: "q1",
		status: "DRAFT" as const,
		version: "v1",
		question: multipleChoice,
	};

	await db.question.upsert(input, opts);
	await db.question.upsert(input, opts);

	expect(await versionsOf(course.id)).toHaveLength(1);
});

test("upsert() refuses an instructor who does not own the course, on either branch", async () => {
	const { course } = await seedQuestion();
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });

	for (const slug of ["q1", "fresh"]) {
		await expect(
			db.question.upsert(
				{
					courseId: course.id,
					slug,
					status: "DRAFT",
					version: "v9",
					question: edited,
				},
				{ actor: stranger },
			),
		).rejects.toThrow();
	}
	expect(
		await prisma.questionRef.count({ where: { courseId: course.id } }),
	).toBe(1);
});

test("delete() archives the question and keeps its versions", async () => {
	const { course, opts, pk } = await seedQuestion();

	await db.question.delete(pk, opts);

	const ref = await prisma.questionRef.findFirstOrThrow({ where: pk });
	expect(ref.status).toBe("ARCHIVED");
	expect(ref.latestId).not.toBeNull();
	expect(await versionsOf(course.id)).toHaveLength(1);
	expect((await db.question.findOne(pk, opts))?.status).toBe("ARCHIVED");
});

test("delete() is idempotent on an archived question", async () => {
	const { opts, pk } = await seedQuestion();

	await db.question.delete(pk, opts);
	await db.question.delete(pk, opts);

	expect(
		(await prisma.questionRef.findFirstOrThrow({ where: pk })).status,
	).toBe("ARCHIVED");
});

test("update() on an archived question is refused", async () => {
	const { course, opts, pk } = await seedQuestion();
	await db.question.delete(pk, opts);

	await expect(
		db.question.update(pk, { status: "PUBLISHED" }, opts),
	).rejects.toMatchObject({ status: 409 });
	await expect(
		db.question.update(pk, { version: "v2", question: edited }, opts),
	).rejects.toMatchObject({ status: 409 });

	expect(await versionsOf(course.id)).toHaveLength(1);
	expect(
		(await prisma.questionRef.findFirstOrThrow({ where: pk })).status,
	).toBe("ARCHIVED");
});

for (const method of ["create", "upsert"] as const) {
	test(`${method}() revives an archived question in place, keeping its history`, async () => {
		const { course, opts, pk } = await seedQuestion();
		const before = await prisma.questionRef.findFirstOrThrow({ where: pk });
		await db.question.delete(pk, opts);

		const revived = await db.question[method](
			{
				courseId: course.id,
				slug: "q1",
				status: "DRAFT",
				version: "v2",
				question: edited,
			},
			opts,
		);

		expect(revived.status).toBe("DRAFT");
		expect(revived.version).toBe("v2");
		const after = await prisma.questionRef.findFirstOrThrow({ where: pk });
		expect(after.id).toBe(before.id);
		expect(after.publicId).toBe(before.publicId);
		expect((await versionsOf(course.id)).map((v) => v.versionHash)).toEqual([
			"v1",
			"v2",
		]);
	});
}

test("create() still refuses a slug held by a live question", async () => {
	const { course, opts } = await seedQuestion("DRAFT");

	await expect(
		db.question.create(
			{
				courseId: course.id,
				slug: "q1",
				status: "DRAFT",
				version: "v2",
				question: edited,
			},
			opts,
		),
	).rejects.toThrow();
	expect(await versionsOf(course.id)).toHaveLength(1);
});

test("delete() refuses an instructor who does not own the course", async () => {
	const { pk } = await seedQuestion();
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });

	await expect(db.question.delete(pk, { actor: stranger })).rejects.toThrow();
	expect(
		(await prisma.questionRef.findFirstOrThrow({ where: pk })).status,
	).toBe("PUBLISHED");
});

test("delete() refuses a missing question", async () => {
	const { course, opts } = await seedQuestion();

	await expect(
		db.question.delete({ courseId: course.id, slug: "nope" }, opts),
	).rejects.toMatchObject({ status: 404 });
});

//
// Visibility
//

test("findMany() returns exactly the questions the read permission allows, for every kind of actor", async () => {
	const a = await makeCourse();
	const b = await makeCourse();
	const enrolled = await persistedUserFactory.create({ role: "STUDENT" });
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	await db.enrollment.create(
		{ courseId: a.course.id, username: enrolled.username },
		FULL_ACCESS,
	);

	for (const { course, opts } of [a, b]) {
		for (const status of ["DRAFT", "PUBLISHED", "ARCHIVED"] as const) {
			await db.question.create(
				{
					courseId: course.id,
					slug: status.toLowerCase(),
					status,
					version: "v1",
					question: multipleChoice,
				},
				opts,
			);
		}
	}

	// The rows as stored, with what the permission needs to judge them.
	const stored = await prisma.questionRef.findMany({
		where: { courseId: { in: [a.course.id, b.course.id] } },
		include: {
			course: {
				select: {
					instructor: { select: { username: true } },
					enrollments: {
						where: { status: "ACTIVE" },
						select: { username: true },
					},
				},
			},
		},
	});
	expect(stored).toHaveLength(6);

	for (const actor of [SYSTEM, a.opts.actor, enrolled, admin] as Actor[]) {
		for (const isPublic of [true, false]) {
			const perm = isPublic ? "question.read-public" : "question.read";
			const allowed = stored
				.filter((r) => r.courseId === a.course.id && hasPerm(actor, perm, r))
				.map((r) => r.slug)
				.sort();

			// Demanding the whole document without the right to it is refused
			// outright, rather than answered with an empty list.
			if (!isPublic && allowed.length === 0) {
				await expect(
					db.question.findMany(
						{ courseId: a.course.id, public: isPublic },
						{ actor },
					),
				).rejects.toMatchObject({ status: 403 });
				continue;
			}

			const listed = await db.question.findMany(
				{ courseId: a.course.id, public: isPublic },
				{ actor },
			);

			// Every question that came back is one the permission allows, and
			// none that it allows was left behind.
			for (const q of listed) {
				const row = stored.find(
					(r) => r.courseId === a.course.id && r.slug === q.slug,
				);
				expect(hasPerm(actor, perm, valueOrFail(row))).toBe(true);
			}
			expect(listed.map((q) => q.slug).sort()).toEqual(allowed);
		}
	}

	// Pin the rule itself, not just the agreement.
	const visible = (actor: Actor, isPublic: boolean) =>
		stored
			.filter((q) =>
				hasPerm(actor, isPublic ? "question.read-public" : "question.read", q),
			)
			.map((q) => `${q.courseId === a.course.id ? "a" : "b"}/${q.slug}`)
			.sort();
	expect(visible(enrolled, true)).toEqual(["a/published"]);
	expect(visible(enrolled, false)).toEqual([]);
	expect(visible(admin, true)).toEqual(["a/published", "b/published"]);
	expect(visible(admin, false)).toEqual([]);
	expect(visible(a.opts.actor, false)).toEqual([
		"a/archived",
		"a/draft",
		"a/published",
	]);
});

test("an enrolled student sees only published questions", async () => {
	const { course, opts } = await makeCourse();
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	for (const status of ["DRAFT", "PUBLISHED", "ARCHIVED"] as const) {
		await db.question.create(
			{
				courseId: course.id,
				slug: status.toLowerCase(),
				status,
				version: "v1",
				question: multipleChoice,
			},
			opts,
		);
	}

	const listed = await db.question.findMany(
		{ courseId: course.id },
		{ actor: student },
	);
	expect(listed.map((q) => q.slug)).toEqual(["published"]);

	// Hidden as if they never existed, not refused.
	for (const slug of ["draft", "archived"]) {
		expect(
			await db.question.findOne(
				{ courseId: course.id, slug },
				{ actor: student },
			),
		).toBeNull();
	}
});

test("an admin who does not teach the course reads only the public half of published questions", async () => {
	const { course, opts } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	for (const status of ["DRAFT", "PUBLISHED"] as const) {
		await db.question.create(
			{
				courseId: course.id,
				slug: status.toLowerCase(),
				status,
				version: "v1",
				question: trueFalse,
			},
			opts,
		);
	}

	const found = await db.question.findOne(
		{ courseId: course.id, slug: "published" },
		{ actor: admin },
	);
	const listed = await db.question.findMany(
		{ courseId: course.id },
		{ actor: admin },
	);

	expect(listed.map((q) => q.slug)).toEqual(["published"]);
	for (const q of [found, ...listed]) {
		const doc = q?.question as PublicQuestion & { type: "true-false" };
		expect(doc.choices[0]).not.toHaveProperty("correct");
	}
	expect(
		await db.question.findOne(
			{ courseId: course.id, slug: "draft" },
			{ actor: admin },
		),
	).toBeNull();
});

test("writes to a draft by a non-author are 404, as if it never existed", async () => {
	const { pk } = await seedQuestion("DRAFT");
	const stranger = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const admin = await persistedUserFactory.create({ role: "ADMIN" });

	for (const actor of [stranger, admin]) {
		await expect(
			db.question.update(pk, { status: "PUBLISHED" }, { actor }),
		).rejects.toMatchObject({ status: 404 });
		await expect(db.question.delete(pk, { actor })).rejects.toMatchObject({
			status: 404,
		});
	}
	expect(
		(await prisma.questionRef.findFirstOrThrow({ where: pk })).status,
	).toBe("DRAFT");
});

//
// The `public` flag
//

test("findOne() and findMany() honour `public` for the author", async () => {
	const { course, opts } = await makeCourse();
	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: trueFalse,
		},
		opts,
	);
	const pk = { courseId: course.id, slug: "q1" };

	// The overloads narrow the return type; these assignments are the check.
	const full: Question | null = await db.question.findOne(
		{ ...pk, public: false },
		opts,
	);
	const half: QuestionPublic | null = await db.question.findOne(
		{ ...pk, public: true },
		opts,
	);
	const fullList: Question[] = await db.question.findMany(
		{ courseId: course.id, public: false },
		opts,
	);
	const halfList: QuestionPublic[] = await db.question.findMany(
		{ courseId: course.id, public: true },
		opts,
	);

	for (const q of [full, fullList[0]]) {
		const doc = q?.question as Doc & { type: "true-false" };
		expect(doc.choices[0]).toHaveProperty("correct");
	}
	for (const q of [half, halfList[0]]) {
		const doc = q?.question as PublicQuestion & { type: "true-false" };
		expect(doc.choices[0]).not.toHaveProperty("correct");
	}
});

test("asking for the whole document without the right to it is refused", async () => {
	const { course, opts } = await makeCourse();
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			courseId: course.id,
			slug: "q1",
			status: "PUBLISHED",
			version: "v1",
			question: trueFalse,
		},
		opts,
	);

	await expect(
		db.question.findOne(
			{ courseId: course.id, slug: "q1", public: false },
			{ actor: student },
		),
	).rejects.toMatchObject({ status: 403 });
	await expect(
		db.question.findMany(
			{ courseId: course.id, public: false },
			{ actor: student },
		),
	).rejects.toMatchObject({ status: 403 });

	// The same reads without the flag succeed with the public half.
	expect(
		await db.question.findOne(
			{ courseId: course.id, slug: "q1" },
			{ actor: student },
		),
	).not.toBeNull();
});

/** Narrows away the `undefined` a `find()` may return, failing the test instead. */
function valueOrFail<T>(value: T | undefined): T {
	expect(value).toBeDefined();
	return value as T;
}
