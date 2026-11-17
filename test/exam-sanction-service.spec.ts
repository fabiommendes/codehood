import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import {
	InvalidData,
	NotAllowed,
	NotFound,
	PreconditionFailed,
} from "@/core/error";
import { db, schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	makeQuestion,
} from "./conditional-write-exam-support";

//
// Setup: a course, an ongoing exam with two questions, students with attempts
//

type ExamType = "EXAM" | "QUIZ" | "PRACTICE";

async function setup(type: ExamType = "EXAM") {
	const { course, instructor } = await makeCourse();
	const q1 = await makeQuestion(course.id);
	const q2 = await makeQuestion(course.id);
	const exam = await makeExam(course.id, {
		type,
		questions: [{ slug: q1.slug }, { slug: q2.slug }],
	});
	return { course, instructor, q1, q2, exam, as: actorOf(instructor) };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

/// An enrolled student with an attempt on the exam.
async function attempt(ctx: Ctx) {
	const student = await enroll(ctx.course.id);
	const response = await persistedResponseFactory.create({
		course: ctx.course.id,
		exam: ctx.exam.slug,
		author: student.username,
	});
	return { student, response };
}

/// Sanctions `usernames` on the setup's exam, as its instructor.
function sanction(
	ctx: Ctx,
	usernames: string[],
	extra: Partial<Parameters<typeof db.examSanction.create>[0]> = {},
) {
	return db.examSanction.create(
		{ course: ctx.course.id, exam: ctx.exam.slug, usernames, ...extra },
		ctx.as,
	);
}

/// The key of a sanction read back.
function pkOf(ctx: Ctx, view: { publicId: string }) {
	return {
		course: ctx.course.id,
		exam: ctx.exam.slug,
		publicId: view.publicId,
	};
}

/// Rows stored for the exam, revoked or not, which is what "nothing written" is measured on.
function stored(ctx: Ctx) {
	return prisma.examSanction.count({
		where: { response: { examId: ctx.exam.id } },
	});
}

/// Closes the exam and releases its grades.
async function release(ctx: Ctx) {
	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - 60_000),
		},
	});
}

/// The `InvalidData` a promise is refused with, failing the test if it resolves.
async function invalid(attempted: Promise<unknown>): Promise<InvalidData> {
	const error = await attempted.then(
		() => null,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(InvalidData);
	return error as InvalidData;
}

//
// create
//

test("create: sanctions two students at once, readable back with createdBy and active", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const bia = await attempt(ctx);

	const created = await sanction(
		ctx,
		[ana.student.username, bia.student.username],
		{ reason: "plagiarism", notes: "same code as a classmate" },
	);

	expect(created).toHaveLength(2);
	expect(created.map((row) => row.author)).toEqual([
		ana.student.username,
		bia.student.username,
	]);
	expect(created.map((row) => row.response)).toEqual([
		ana.response.publicId,
		bia.response.publicId,
	]);
	for (const row of created) {
		expect(row).toMatchObject({
			exam: ctx.exam.slug,
			question: null,
			factor: "0",
			reason: "plagiarism",
			notes: "same code as a classmate",
			createdBy: ctx.instructor.username,
			revokedAt: null,
			revokedBy: null,
		});
		expect(row.createdAt).toBeInstanceOf(Date);
	}
	const found = await db.examSanction.findOne(
		pkOf(
			ctx,
			created[0] ?? {
				publicId: "",
			},
		),
		ctx.as,
	);
	expect(found).toMatchObject({ author: ana.student.username, factor: "0" });
	expect(
		await db.examSanction.findMany(
			{ course: ctx.course.id, exam: ctx.exam.slug },
			ctx.as,
		),
	).toHaveLength(2);
});

test("create: a student without an attempt refuses the whole batch and writes nothing", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const bia = await enroll(ctx.course.id);

	const error = await invalid(
		sanction(ctx, [ana.student.username, bia.username]),
	);

	expect(error.errors.usernames?.[0]?.code).toBe("invalid");
	expect(await stored(ctx)).toBe(0);
});

test("create: a preview attempt is refused", async () => {
	const ctx = await setup();
	await db.response.create(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		ctx.as,
	);

	const error = await invalid(sanction(ctx, [ctx.instructor.username]));

	expect(error.errors.usernames?.[0]?.code).toBe("invalid");
	expect(await stored(ctx)).toBe(0);
});

test("create: a PRACTICE exam is refused", async () => {
	const ctx = await setup("PRACTICE");
	const ana = await attempt(ctx);

	const error = await invalid(sanction(ctx, [ana.student.username]));

	expect(error.errors).toHaveProperty("exam");
	expect(await stored(ctx)).toBe(0);
});

test("create: a question outside the exam is refused", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const outside = await makeQuestion(ctx.course.id);

	const error = await invalid(
		sanction(ctx, [ana.student.username], { question: outside.slug }),
	);

	expect(error.errors).toHaveProperty("question");
	expect(await stored(ctx)).toBe(0);
});

test("create: a second active sanction on the same target is refused, not-unique", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const bia = await attempt(ctx);
	await sanction(ctx, [ana.student.username]);

	// The whole exam: refused, and the batch's other student is not written.
	const again = await invalid(
		sanction(ctx, [bia.student.username, ana.student.username]),
	);
	expect(again.errors.usernames?.[0]?.code).toBe("not-unique");
	expect(await stored(ctx)).toBe(1);

	// A sanction on the exam does not block one on a question.
	const onQuestion = await sanction(ctx, [ana.student.username], {
		question: ctx.q1.slug,
	});
	expect(onQuestion[0]?.question).toBe(ctx.q1.slug);

	// The same question twice: refused. Another question is another target.
	const sameQuestion = await invalid(
		sanction(ctx, [ana.student.username], { question: ctx.q1.slug }),
	);
	expect(sameQuestion.errors.usernames?.[0]?.code).toBe("not-unique");
	await sanction(ctx, [ana.student.username], { question: ctx.q2.slug });
	expect(await stored(ctx)).toBe(3);
});

test("create: after revoking, the same target can be sanctioned again", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [first] = await sanction(ctx, [ana.student.username]);
	await db.examSanction.revoke(pkOf(ctx, first ?? { publicId: "" }), ctx.as);

	const [second] = await sanction(ctx, [ana.student.username]);

	expect(second?.publicId).not.toBe(first?.publicId);
	expect(await stored(ctx)).toBe(2);
	const filter = { course: ctx.course.id, exam: ctx.exam.slug };
	const active = await db.examSanction.findMany(filter, ctx.as);
	expect(active.map((row) => row.publicId)).toEqual([second?.publicId]);
	const all = await db.examSanction.findMany(
		{ ...filter, revoked: true },
		ctx.as,
	);
	expect(all.map((row) => row.publicId)).toEqual([
		first?.publicId,
		second?.publicId,
	]);
});

test("create: reason and notes are trimmed and an empty one is stored as null", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const bia = await attempt(ctx);
	const cleo = await attempt(ctx);

	const [trimmed] = await sanction(ctx, [ana.student.username], {
		reason: "  copied  ",
		notes: "\n evidence \t",
	});
	const [blank] = await sanction(ctx, [bia.student.username], {
		reason: "   ",
		notes: "",
	});
	const [updated] = await sanction(ctx, [cleo.student.username], {
		reason: "x",
		notes: "y",
	});
	const cleared = await db.examSanction.update(
		pkOf(ctx, updated ?? { publicId: "" }),
		{ reason: "", notes: "  " },
		ctx.as,
	);

	expect(trimmed).toMatchObject({ reason: "copied", notes: "evidence" });
	expect(blank).toMatchObject({ reason: null, notes: null });
	expect(cleared).toMatchObject({ reason: null, notes: null });
});

test("create: a reason over 2000 characters is refused", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);

	const error = await invalid(
		sanction(ctx, [ana.student.username], { reason: "x".repeat(2001) }),
	);

	expect(error.errors).toHaveProperty("reason");
	expect(await stored(ctx)).toBe(0);
});

//
// update, revoke
//

test("update: changes factor, reason and notes of an active sanction; a revoked one is 409", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [created] = await sanction(ctx, [ana.student.username], {
		reason: "first",
	});
	const pk = pkOf(ctx, created ?? { publicId: "" });

	const updated = await db.examSanction.update(
		pk,
		{ factor: "0.5", reason: "second", notes: "private" },
		ctx.as,
	);
	expect(updated).toMatchObject({
		factor: "0.5",
		reason: "second",
		notes: "private",
		revokedAt: null,
	});
	const partial = await db.examSanction.update(pk, { reason: "third" }, ctx.as);
	expect(partial).toMatchObject({
		factor: "0.5",
		reason: "third",
		notes: "private",
	});

	await db.examSanction.revoke(pk, ctx.as);
	const refused = db.examSanction.update(pk, { factor: "0.1" }, ctx.as);
	await expect(refused).rejects.toBeInstanceOf(NotAllowed);
	await expect(refused).rejects.toMatchObject({
		status: 409,
		action: "exam-sanction.update",
	});
	expect((await db.examSanction.findOne(pk, ctx.as))?.factor).toBe("0.5");
});

test("update: a factor of 1 or more is refused", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [created] = await sanction(ctx, [ana.student.username]);

	const error = await invalid(
		db.examSanction.update(
			pkOf(ctx, created ?? { publicId: "" }),
			{ factor: "1" },
			ctx.as,
		),
	);

	expect(error.errors).toHaveProperty("factor");
});

test("update and revoke: an unknown sanction is NotFound", async () => {
	const ctx = await setup();
	const pk = { course: ctx.course.id, exam: ctx.exam.slug, publicId: "nope" };

	await expect(
		db.examSanction.update(pk, { factor: "0.5" }, ctx.as),
	).rejects.toBeInstanceOf(NotFound);
	await expect(db.examSanction.revoke(pk, ctx.as)).rejects.toBeInstanceOf(
		NotFound,
	);
	expect(await db.examSanction.findOne(pk, ctx.as)).toBeNull();
});

test("revoke: records revokedBy and revokedAt and keeps the row; revoking again is 409", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [created] = await sanction(ctx, [ana.student.username]);
	const pk = pkOf(ctx, created ?? { publicId: "" });
	const before = Date.now();

	const revoked = await db.examSanction.revoke(pk, ctx.as);

	expect(revoked.revokedBy).toBe(ctx.instructor.username);
	expect(revoked.revokedAt?.getTime()).toBeGreaterThanOrEqual(before - 5000);
	expect(await stored(ctx)).toBe(1);
	const row = await prisma.examSanction.findFirstOrThrow({
		where: { publicId: pk.publicId },
	});
	expect(row.revokedById).toBe(ctx.instructor.username);
	expect(row.revokedAt).not.toBeNull();

	const again = db.examSanction.revoke(pk, ctx.as);
	await expect(again).rejects.toBeInstanceOf(NotAllowed);
	await expect(again).rejects.toMatchObject({
		status: 409,
		action: "exam-sanction.revoke",
	});
});

test("update/revoke: a stale expectedUpdatedAt is PreconditionFailed and changes nothing", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [created] = await sanction(ctx, [ana.student.username], {
		reason: "kept",
	});
	if (!created) throw new Error("no sanction created");
	const pk = pkOf(ctx, created);
	const stale = { ...ctx.as, expectedUpdatedAt: new Date(0) };

	await expect(
		db.examSanction.update(pk, { reason: "lost" }, stale),
	).rejects.toBeInstanceOf(PreconditionFailed);
	await expect(db.examSanction.revoke(pk, stale)).rejects.toBeInstanceOf(
		PreconditionFailed,
	);

	const after = await db.examSanction.findOne(pk, ctx.as);
	expect(after).toMatchObject({ reason: "kept", revokedAt: null });
	expect(after?.updatedAt).toEqual(created.updatedAt);

	const current = { ...ctx.as, expectedUpdatedAt: created.updatedAt };
	const updated = await db.examSanction.update(pk, { reason: "ok" }, current);
	await db.examSanction.revoke(pk, {
		...ctx.as,
		expectedUpdatedAt: updated.updatedAt,
	});
});

//
// permissions
//

test("permissions: only the course's instructor writes", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [created] = await sanction(ctx, [ana.student.username], {
		reason: "kept",
	});
	if (!created) throw new Error("no sanction created");
	const pk = pkOf(ctx, created);
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const other = await makeCourse();
	const actors = {
		admin: actorOf(admin),
		"another course's instructor": actorOf(other.instructor),
		"the sanctioned student": actorOf(ana.student),
		SYSTEM: FULL_ACCESS,
		"a BOT key of the instructor": {
			actor: { ...ctx.as.actor, bot: "runner" },
		},
	};

	for (const [label, opts] of Object.entries(actors)) {
		await expect(
			db.examSanction.create(
				{
					course: ctx.course.id,
					exam: ctx.exam.slug,
					usernames: [ana.student.username],
					question: ctx.q1.slug,
				},
				opts,
			),
			`create by ${label}`,
		).rejects.toBeInstanceOf(NotAllowed);
		// An actor who cannot read the sanction may be told it is missing instead.
		for (const write of [
			db.examSanction.update(pk, { reason: "lost" }, opts),
			db.examSanction.revoke(pk, opts),
		]) {
			const error = await write.then(
				() => null,
				(e: unknown) => e,
			);
			expect(
				error instanceof NotAllowed || error instanceof NotFound,
				`write by ${label}`,
			).toBe(true);
		}
	}

	expect(await stored(ctx)).toBe(1);
	expect(await db.examSanction.findOne(pk, ctx.as)).toMatchObject({
		reason: "kept",
		revokedAt: null,
	});
});

//
// reads by staff
//

test("findMany: staff gets notes and, with revoked: true, the revoked ones", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const bia = await attempt(ctx);
	await sanction(ctx, [ana.student.username], { notes: "ana evidence" });
	const [gone] = await sanction(ctx, [bia.student.username], {
		notes: "bia evidence",
	});
	await db.examSanction.revoke(pkOf(ctx, gone ?? { publicId: "" }), ctx.as);
	const filter = { course: ctx.course.id, exam: ctx.exam.slug };

	const active = await db.examSanction.findMany(filter, ctx.as);
	const everything = await db.examSanction.findMany(
		{ ...filter, revoked: true },
		ctx.as,
	);
	const ofBia = await db.examSanction.findMany(
		{ ...filter, revoked: true, author: bia.student.username },
		ctx.as,
	);
	const courseWide = await db.examSanction.findMany(
		{ course: ctx.course.id },
		ctx.as,
	);

	expect(active.map((row) => row.author)).toEqual([ana.student.username]);
	expect(active[0]).toMatchObject({
		notes: "ana evidence",
		createdBy: ctx.instructor.username,
	});
	expect(everything.map((row) => row.author)).toEqual([
		ana.student.username,
		bia.student.username,
	]);
	expect(everything[1]).toMatchObject({
		notes: "bia evidence",
		revokedBy: ctx.instructor.username,
	});
	expect(ofBia.map((row) => row.author)).toEqual([bia.student.username]);
	expect(courseWide.map((row) => row.author)).toEqual([ana.student.username]);
});

test("admin: reads no sanction of a course they do not teach", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [created] = await sanction(ctx, [ana.student.username], {
		notes: "private",
	});
	const admin = actorOf(await persistedUserFactory.create({ role: "ADMIN" }));

	const listed = await db.examSanction
		.findMany({ course: ctx.course.id, exam: ctx.exam.slug }, admin)
		.catch((e: unknown) => e);
	if (Array.isArray(listed)) expect(listed).toEqual([]);
	else expect(listed).toBeInstanceOf(NotAllowed);

	const found = await db.examSanction
		.findOne(pkOf(ctx, created ?? { publicId: "" }), admin)
		.catch((e: unknown) => e);
	if (found instanceof Error) expect(found).toBeInstanceOf(NotAllowed);
	else expect(found).toBeNull();
});

//
// reads by the sanctioned student
//

/// The keys a student's read of a sanction must have: the staff row without `notes`, `createdBy` and `revokedBy`.
const STUDENT_KEYS = [
	"author",
	"createdAt",
	"exam",
	"factor",
	"id",
	"publicId",
	"question",
	"reason",
	"response",
	"revokedAt",
	"updatedAt",
];

test("student: sees nothing before an EXAM's release and their own active sanction after, without notes, createdBy or revokedBy", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const [created] = await sanction(ctx, [ana.student.username], {
		reason: "copied",
		notes: "private evidence",
	});
	const pk = pkOf(ctx, created ?? { publicId: "" });
	const filter = { course: ctx.course.id, exam: ctx.exam.slug };
	const asAna = actorOf(ana.student);

	expect(await db.examSanction.findMany(filter, asAna)).toEqual([]);
	expect(await db.examSanction.findOne(pk, asAna)).toBeNull();

	await release(ctx);

	const rows = await db.examSanction.findMany(filter, asAna);
	expect(rows).toHaveLength(1);
	expect(rows[0]).toMatchObject({
		author: ana.student.username,
		question: null,
		factor: "0",
		reason: "copied",
		revokedAt: null,
	});
	expect(Object.keys(rows[0] ?? {}).sort()).toEqual(STUDENT_KEYS);
	const one = await db.examSanction.findOne(pk, asAna);
	expect(Object.keys(one ?? {}).sort()).toEqual(STUDENT_KEYS);
});

test("student: a closed QUIZ shows its sanction; an open one does not", async () => {
	const ctx = await setup("QUIZ");
	const ana = await attempt(ctx);
	await sanction(ctx, [ana.student.username], { reason: "copied" });
	const filter = { course: ctx.course.id, exam: ctx.exam.slug };
	const asAna = actorOf(ana.student);

	expect(await db.examSanction.findMany(filter, asAna)).toEqual([]);

	await prisma.exam.update({
		where: { id: ctx.exam.id },
		data: { status: "COMPLETED" },
	});

	const rows = await db.examSanction.findMany(filter, asAna);
	expect(rows.map((row) => row.reason)).toEqual(["copied"]);
	expect(Object.keys(rows[0] ?? {})).not.toContain("notes");
});

test("student: a revoked sanction and a classmate's are invisible, and findOne of them is null", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);
	const bia = await attempt(ctx);
	const [first] = await sanction(ctx, [ana.student.username]);
	const revoked = await db.examSanction.revoke(
		pkOf(ctx, first ?? { publicId: "" }),
		ctx.as,
	);
	const [own] = await sanction(ctx, [ana.student.username], {
		question: ctx.q1.slug,
	});
	const [classmates] = await sanction(ctx, [bia.student.username]);
	await release(ctx);
	const asAna = actorOf(ana.student);
	const filter = { course: ctx.course.id, exam: ctx.exam.slug };

	const rows = await db.examSanction.findMany(
		{ ...filter, revoked: true },
		asAna,
	);

	expect(rows.map((row) => row.publicId)).toEqual([own?.publicId]);
	expect(await db.examSanction.findOne(pkOf(ctx, revoked), asAna)).toBeNull();
	expect(
		await db.examSanction.findOne(
			pkOf(ctx, classmates ?? { publicId: "" }),
			asAna,
		),
	).toBeNull();
	expect(
		await db.examSanction.findOne(pkOf(ctx, own ?? { publicId: "" }), asAna),
	).not.toBeNull();
	// Asking for a classmate's sanctions does not leak them either.
	const aimed = await db.examSanction
		.findMany({ ...filter, author: bia.student.username }, asAna)
		.catch((e: unknown) => e);
	if (Array.isArray(aimed)) expect(aimed).toEqual([]);
	else expect(aimed).toBeInstanceOf(NotAllowed);
});

//
// the factor
//

const factors: Array<[string, boolean]> = [
	["0", true],
	["0.5", true],
	["0.25", true],
	["0.999", true],
	["1", false],
	["1.0", false],
	["-0.1", false],
	[".5", false],
	["0.", false],
	["0,5", false],
	["00.5", false],
	["", false],
	[" 0.5", false],
];

for (const [value, ok] of factors) {
	test(`sanctionFactor: ${JSON.stringify(value)} is ${ok ? "accepted" : "refused"}`, () => {
		expect(schema.sanctionFactor.safeParse(value).success).toBe(ok);
	});
}

test("create: a factor of 1 is refused and writes nothing", async () => {
	const ctx = await setup();
	const ana = await attempt(ctx);

	const error = await invalid(
		sanction(ctx, [ana.student.username], { factor: "1" }),
	);

	expect(error.errors).toHaveProperty("factor");
	expect(await stored(ctx)).toBe(0);
});

test("create: an empty list of students is refused", async () => {
	const ctx = await setup();

	const error = await invalid(sanction(ctx, []));

	expect(error.errors).toHaveProperty("usernames");
});
