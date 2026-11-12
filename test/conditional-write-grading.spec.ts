import { expect, test } from "@playwright/test";
import { InvalidData, NotFound, PreconditionFailed } from "@/core/error";
import type {
	FeedbackId,
	RegradeRequestId,
	SubmissionId,
} from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	createRubricScenario,
	type RubricScenario,
	type ScenarioAnswer,
	storedScore,
} from "@/fixtures/rubric-scenario";
import { persistedUserFactory } from "@/fixtures/user.factory";

/// ADR 0013 for feedback, rubric (with its items) and regradeRequest. Every
/// scenario creates its own course, exam and users, so no spec depends on the
/// seed or on a sibling spec's rows.
///
/// The rubric has two versions in play: the rubric row (`update`, `createItem`,
/// `renameGroup`) and the row of one item (`updateItem`, `upsertItem`,
/// `deleteItem`, `splitItem`). Every write on an item also moves the rubric.

const STALE = new Date(0);
const GRADER_REF = "pass-1";

const as = (scenario: RubricScenario, expectedUpdatedAt?: Date | null) => ({
	actor: scenario.instructor,
	...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
});

/// Settles a promise to the {@link PreconditionFailed} it throws, or fails the test.
async function failure(promise: Promise<unknown>): Promise<PreconditionFailed> {
	const err = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(err).toBeInstanceOf(PreconditionFailed);
	return err as PreconditionFailed;
}

const feedbackRow = (id: number) =>
	prisma.feedback.findUniqueOrThrow({ where: { id: id as FeedbackId } });
const rubricRow = (examId: number) =>
	prisma.rubric.findFirstOrThrow({ where: { examId } });
const itemRow = (id: number) =>
	prisma.rubricItem.findUniqueOrThrow({ where: { id } });
const requestRow = (id: number) =>
	prisma.regradeRequest.findUniqueOrThrow({
		where: { id: id as RegradeRequestId },
	});
const responseRow = (publicId: string) =>
	prisma.response.findUniqueOrThrow({ where: { publicId } });

/// A scenario with a stored rubric of three items: `a` and `b` in group `G`, `c` alone.
async function rubricScenario() {
	const scenario = await createRubricScenario();
	const rubric = await scenario.seedRubric({
		items: [
			{ key: "a", group: "G/One", value: "0.5" },
			{ key: "b", group: "G/Two", value: "0.25" },
			{ key: "c", value: "0.25" },
		],
	});
	return { scenario, rubric, pk: scenario.main.pk };
}

/// A scenario with a graded answer: `pass-1`, scored by hand.
async function gradedScenario() {
	const scenario = await createRubricScenario();
	const answer = await scenario.addAnswer();
	const pass = await db.feedback.create(
		{
			submission: { id: answer.submission.id },
			ref: GRADER_REF,
			score: "0.5",
		},
		as(scenario),
	);
	return { scenario, answer, pass, filter: { id: pass.id } };
}

//
// feedback
//

test("feedback.update: right version writes and bumps, stale throws with the current one and writes nothing", async () => {
	const { scenario, pass, filter } = await gradedScenario();

	const stale = await failure(
		db.feedback.update(filter, { score: "1" }, as(scenario, STALE)),
	);
	expect(stale.updatedAt?.getTime()).toBe(pass.updatedAt.getTime());
	expect((await feedbackRow(pass.id)).score).toBe("0.5");

	const row = await db.feedback.update(
		filter,
		{ score: "1" },
		as(scenario, pass.updatedAt),
	);
	expect(row.score).toBe("1");
	expect(row.updatedAt.getTime()).toBeGreaterThan(pass.updatedAt.getTime());
});

test("feedback.update: absent expectation writes", async () => {
	const { scenario, pass, filter } = await gradedScenario();
	await db.feedback.update(filter, { notes: "n" }, as(scenario));
	expect((await feedbackRow(pass.id)).notes).toBe("n");
});

test("feedback.upsert: a stale caller gets the 412 before the refusal of a missing score", async () => {
	const { scenario, answer } = await gradedScenario();
	const err = await db.feedback
		.upsert(
			{ submission: { id: answer.submission.id }, ref: GRADER_REF },
			as(scenario, STALE),
		)
		.catch((e: unknown) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
});

test("feedback.update and delete: a Date on a missing pass is a 412 with null, none is a NotFound", async () => {
	const { scenario, answer } = await gradedScenario();
	const missing = { id: 2_000_000_000 as FeedbackId };
	for (const run of [
		(o: ReturnType<typeof as>) =>
			db.feedback.update(missing, { notes: "x" }, o),
		(o: ReturnType<typeof as>) => db.feedback.delete(missing, o),
	]) {
		expect((await failure(run(as(scenario, STALE)))).updatedAt).toBeNull();
		await expect(run(as(scenario))).rejects.toBeInstanceOf(NotFound);
	}

	const byRef = { submission: { id: answer.submission.id }, ref: "none" };
	expect(
		(await failure(db.feedback.delete(byRef, as(scenario, STALE)))).updatedAt,
	).toBeNull();

	// The mother of the key is missing: still a NotFound.
	const orphan = {
		submission: { id: 2_000_000_000 as SubmissionId },
		ref: GRADER_REF,
	};
	await expect(
		db.feedback.delete(orphan, as(scenario, STALE)),
	).rejects.toBeInstanceOf(NotFound);
});

test("feedback.upsert: null creates, then fails when the pass exists", async () => {
	const { scenario, answer } = await gradedScenario();
	const input = {
		submission: { id: answer.submission.id },
		ref: "pass-2",
		score: "0.25",
	};
	const created = await db.feedback.upsert(input, as(scenario, null));
	const err = await failure(db.feedback.upsert(input, as(scenario, null)));
	expect(err.updatedAt?.getTime()).toBe(created.updatedAt.getTime());
});

test("feedback.upsert: Date updates when right, fails when stale or when the pass is absent", async () => {
	const { scenario, answer, pass } = await gradedScenario();
	const input = {
		submission: { id: answer.submission.id },
		ref: GRADER_REF,
		score: "1",
	};
	await failure(db.feedback.upsert(input, as(scenario, STALE)));
	expect((await feedbackRow(pass.id)).score).toBe("0.5");

	const row = await db.feedback.upsert(input, as(scenario, pass.updatedAt));
	expect(row.score).toBe("1");
	expect(row.updatedAt.getTime()).toBeGreaterThan(pass.updatedAt.getTime());

	const absent = await failure(
		db.feedback.upsert({ ...input, ref: "ghost" }, as(scenario, STALE)),
	);
	expect(absent.updatedAt).toBeNull();
	expect(await prisma.feedback.count({ where: { ref: "ghost" } })).toBe(0);
});

test("feedback.upsert: a missing submission stays a NotFound", async () => {
	const { scenario } = await gradedScenario();
	await expect(
		db.feedback.upsert(
			{
				submission: { id: 2_000_000_000 as SubmissionId },
				ref: "x",
				score: "1",
			},
			as(scenario, STALE),
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("feedback.delete: right version deletes, stale throws and keeps it", async () => {
	const { scenario, pass, filter } = await gradedScenario();
	await failure(db.feedback.delete(filter, as(scenario, STALE)));
	expect(await prisma.feedback.count({ where: { id: pass.id } })).toBe(1);

	await db.feedback.delete(filter, as(scenario, pass.updatedAt));
	expect(await prisma.feedback.count({ where: { id: pass.id } })).toBe(0);
});

test("feedback.create and upsert that create a pass move the response through the submission status", async () => {
	const scenario = await createRubricScenario();
	const answer = await scenario.addAnswer();
	const before = await responseRow(answer.response.publicId);

	await db.feedback.create(
		{ submission: { id: answer.submission.id }, ref: "a", score: "1" },
		as(scenario),
	);
	const afterCreate = await responseRow(answer.response.publicId);
	expect(afterCreate.updatedAt.getTime()).toBeGreaterThan(
		before.updatedAt.getTime(),
	);

	// The status is already GRADED_MANUALLY: a second pass and a revision change nothing shown.
	await db.feedback.upsert(
		{ submission: { id: answer.submission.id }, ref: "a", score: "0" },
		as(scenario),
	);
	await db.feedback.create(
		{ submission: { id: answer.submission.id }, ref: "b", score: "0" },
		as(scenario),
	);
	expect(
		(await responseRow(answer.response.publicId)).updatedAt.getTime(),
	).toBe(afterCreate.updatedAt.getTime());
});

test("feedback.delete moves the regrade request that points to the pass", async () => {
	const ctx = await regradeScenario();
	const accepted = await db.regradeRequest.accept(
		{ publicId: ctx.request.publicId },
		{ score: "1", reply: "ok" },
		as(ctx.scenario),
	);
	expect(accepted.feedbackId).not.toBeNull();
	const before = await requestRow(ctx.request.id);

	await db.feedback.delete(
		{ id: accepted.feedbackId as FeedbackId },
		as(ctx.scenario),
	);

	const after = await requestRow(ctx.request.id);
	expect(after.feedbackId).toBeNull();
	expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
});

//
// rubric
//

test("rubric.update: right version writes and bumps, stale throws and writes nothing", async () => {
	const { scenario, pk } = await rubricScenario();
	const before = await rubricRow(scenario.exam.id);

	const stale = await failure(
		db.rubric.update(pk, { base: "1" }, as(scenario, STALE)),
	);
	expect(stale.updatedAt?.getTime()).toBe(before.updatedAt.getTime());
	expect((await rubricRow(scenario.exam.id)).base).toBe("0");

	await db.rubric.update(pk, { base: "1" }, as(scenario, before.updatedAt));
	const after = await rubricRow(scenario.exam.id);
	expect(after.base).toBe("1");
	expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
});

test("rubric.update: absent expectation writes", async () => {
	const { scenario, pk } = await rubricScenario();
	await db.rubric.update(pk, { base: "1" }, as(scenario));
	expect((await rubricRow(scenario.exam.id)).base).toBe("1");
});

test("rubric.update: a rubric not stored yet takes null and no expectation, and a Date is a 412 with null that copies nothing", async () => {
	const scenario = await createRubricScenario({
		rubric: [{ value: "0.5", path: "G/One", text: "One" }],
	});
	const pk = scenario.main.pk;
	const err = await failure(
		db.rubric.update(pk, { base: "1" }, as(scenario, STALE)),
	);
	expect(err.updatedAt).toBeNull();
	expect(
		await prisma.rubric.count({ where: { examId: scenario.exam.id } }),
	).toBe(0);

	await db.rubric.update(pk, { base: "1" }, as(scenario, null));
	expect((await rubricRow(scenario.exam.id)).base).toBe("1");
});

test("rubric.update: the passes whose score moves move with it, the others keep their version", async () => {
	const { scenario, rubric, pk } = await rubricScenario();
	const one = await scenario.addAnswer();
	const two = await scenario.addAnswer();
	const moved = await scenario.seedPass(one, rubric, {
		ref: "r",
		keys: ["a"],
		score: "0.5",
	});
	const kept = await scenario.seedPass(two, rubric, {
		ref: "r",
		keys: ["a"],
		score: "0.5",
	});
	await prisma.feedback.update({
		where: { id: kept },
		data: { rubricId: null },
	});
	const before = {
		moved: await feedbackRow(moved),
		kept: await feedbackRow(kept),
	};

	await db.rubric.update(pk, { base: "0.25" }, as(scenario));

	expect(await storedScore(moved)).toBe("0.75");
	expect((await feedbackRow(moved)).updatedAt.getTime()).toBeGreaterThan(
		before.moved.updatedAt.getTime(),
	);
	expect((await feedbackRow(kept)).updatedAt.getTime()).toBe(
		before.kept.updatedAt.getTime(),
	);
});

test("rubric.createItem: the rubric version is checked, a stale one creates nothing, and a created item moves the rubric", async () => {
	const { scenario, pk } = await rubricScenario();
	const before = await rubricRow(scenario.exam.id);
	const input = { key: "d", text: "D", value: "0.1" };

	await failure(db.rubric.createItem(pk, input, as(scenario, STALE)));
	expect(
		await prisma.rubricItem.count({ where: { rubricId: before.id, key: "d" } }),
	).toBe(0);

	await db.rubric.createItem(pk, input, as(scenario, before.updatedAt));
	expect(
		(await rubricRow(scenario.exam.id)).updatedAt.getTime(),
	).toBeGreaterThan(before.updatedAt.getTime());

	await db.rubric.createItem(pk, { text: "E", value: "0.1" }, as(scenario));
});

test("rubric.updateItem: right item version writes and bumps the item and the rubric, stale throws and writes nothing", async () => {
	const { scenario, rubric, pk } = await rubricScenario();
	const id = rubric.itemIds.a as number;
	const item = await itemRow(id);
	const parent = await rubricRow(scenario.exam.id);
	const itemPk = { ...pk, key: "a" };

	const stale = await failure(
		db.rubric.updateItem(itemPk, { text: "New" }, as(scenario, STALE)),
	);
	expect(stale.updatedAt?.getTime()).toBe(item.updatedAt.getTime());
	expect((await itemRow(id)).text).toBe(item.text);

	await db.rubric.updateItem(
		itemPk,
		{ text: "New" },
		as(scenario, item.updatedAt),
	);
	const after = await itemRow(id);
	expect(after.text).toBe("New");
	expect(after.updatedAt.getTime()).toBeGreaterThan(item.updatedAt.getTime());
	expect(
		(await rubricRow(scenario.exam.id)).updatedAt.getTime(),
	).toBeGreaterThan(parent.updatedAt.getTime());

	await db.rubric.updateItem(itemPk, { text: "Again" }, as(scenario));
	expect((await itemRow(id)).text).toBe("Again");
});

test("rubric.updateItem and deleteItem: a Date on a missing item is a 412 with null, none is a NotFound or a no-op", async () => {
	const { scenario, pk } = await rubricScenario();
	const ghost = { ...pk, key: "ghost" };

	expect(
		(
			await failure(
				db.rubric.updateItem(ghost, { text: "x" }, as(scenario, STALE)),
			)
		).updatedAt,
	).toBeNull();
	expect(
		(await failure(db.rubric.deleteItem(ghost, as(scenario, STALE)))).updatedAt,
	).toBeNull();
	expect(
		(
			await failure(
				db.rubric.splitItem(
					ghost,
					{ children: [{ text: "x", value: "0.1" }] },
					as(scenario, STALE),
				),
			)
		).updatedAt,
	).toBeNull();

	await expect(
		db.rubric.updateItem(ghost, { text: "x" }, as(scenario)),
	).rejects.toBeInstanceOf(NotFound);
	await db.rubric.deleteItem(ghost, as(scenario));
});

test("rubric item writes: a Date on a rubric not stored yet is a 412 with null that copies nothing", async () => {
	const scenario = await createRubricScenario({
		rubric: [{ value: "0.5", path: "G/One", text: "One" }],
	});
	const pk = scenario.main.pk;
	const first = (await db.rubric.findOne(pk, as(scenario))).items[0];
	const itemPk = { ...pk, key: first?.key as string };

	for (const run of [
		() => db.rubric.updateItem(itemPk, { text: "x" }, as(scenario, STALE)),
		() => db.rubric.deleteItem(itemPk, as(scenario, STALE)),
		() =>
			db.rubric.upsertItem(
				itemPk,
				{ text: "x", value: "0.5" },
				as(scenario, STALE),
			),
		() =>
			db.rubric.renameGroup(pk, { from: "G", to: "H" }, as(scenario, STALE)),
		() =>
			db.rubric.createItem(
				pk,
				{ text: "x", value: "0.5" },
				as(scenario, STALE),
			),
	]) {
		expect((await failure(run())).updatedAt).toBeNull();
	}
	expect(
		await prisma.rubric.count({ where: { examId: scenario.exam.id } }),
	).toBe(0);
});

test("rubric.upsertItem: null creates, then fails when the item exists; a Date updates when right", async () => {
	const { scenario, rubric, pk } = await rubricScenario();
	const input = { text: "New", value: "0.1" };
	const fresh = { ...pk, key: "n" };

	await db.rubric.upsertItem(fresh, input, as(scenario, null));
	const created = await prisma.rubricItem.findFirstOrThrow({
		where: { rubricId: rubric.id, key: "n" },
	});
	const err = await failure(
		db.rubric.upsertItem(fresh, input, as(scenario, null)),
	);
	expect(err.updatedAt?.getTime()).toBe(created.updatedAt.getTime());

	await failure(
		db.rubric.upsertItem(fresh, { ...input, text: "x" }, as(scenario, STALE)),
	);
	expect((await itemRow(created.id)).text).toBe("New");
	await db.rubric.upsertItem(
		fresh,
		{ ...input, text: "x" },
		as(scenario, created.updatedAt),
	);
	expect((await itemRow(created.id)).text).toBe("x");

	// A Date on a key that is not there creates nothing.
	const absent = await failure(
		db.rubric.upsertItem({ ...pk, key: "z" }, input, as(scenario, STALE)),
	);
	expect(absent.updatedAt).toBeNull();
	expect(
		await prisma.rubricItem.count({ where: { rubricId: rubric.id, key: "z" } }),
	).toBe(0);
});

test("rubric.upsertItem: a creation moves the rubric", async () => {
	const { scenario, pk } = await rubricScenario();
	const before = await rubricRow(scenario.exam.id);
	await db.rubric.upsertItem(
		{ ...pk, key: "n" },
		{ text: "New", value: "0.1" },
		as(scenario, null),
	);
	expect(
		(await rubricRow(scenario.exam.id)).updatedAt.getTime(),
	).toBeGreaterThan(before.updatedAt.getTime());
});

test("rubric.deleteItem: right version deletes, stale throws and keeps it; the rubric and the passes that applied it move", async () => {
	const { scenario, rubric, pk } = await rubricScenario();
	const answer = await scenario.addAnswer();
	const pass = await scenario.seedPass(answer, rubric, {
		ref: "r",
		keys: ["c"],
		score: "0.25",
	});
	const id = rubric.itemIds.c as number;
	const item = await itemRow(id);
	const before = {
		rubric: await rubricRow(scenario.exam.id),
		pass: await feedbackRow(pass),
	};
	const itemPk = { ...pk, key: "c" };

	await failure(db.rubric.deleteItem(itemPk, as(scenario, STALE)));
	expect(await prisma.rubricItem.count({ where: { id } })).toBe(1);

	await db.rubric.deleteItem(itemPk, as(scenario, item.updatedAt));
	expect(await prisma.rubricItem.count({ where: { id } })).toBe(0);
	expect(
		(await rubricRow(scenario.exam.id)).updatedAt.getTime(),
	).toBeGreaterThan(before.rubric.updatedAt.getTime());
	expect((await feedbackRow(pass)).updatedAt.getTime()).toBeGreaterThan(
		before.pass.updatedAt.getTime(),
	);
});

test("rubric.deleteItem: a pass whose score does not change still moves when it loses an item", async () => {
	const { scenario, rubric, pk } = await rubricScenario();
	const answer = await scenario.addAnswer();
	await prisma.rubricItem.update({
		where: { id: rubric.itemIds.c as number },
		data: { value: "0" },
	});
	const pass = await scenario.seedPass(answer, rubric, {
		ref: "r",
		keys: ["c"],
		score: "0",
	});
	const before = await feedbackRow(pass);

	await db.rubric.deleteItem({ ...pk, key: "c" }, as(scenario));

	expect(await storedScore(pass)).toBe("0");
	expect((await feedbackRow(pass)).updatedAt.getTime()).toBeGreaterThan(
		before.updatedAt.getTime(),
	);
});

test("rubric.splitItem: stale throws and writes nothing; right bumps the parent, the items it shifts and the rubric", async () => {
	const { scenario, rubric, pk } = await rubricScenario();
	const parentId = rubric.itemIds.a as number;
	const shiftedId = rubric.itemIds.b as number;
	const parent = await itemRow(parentId);
	const shifted = await itemRow(shiftedId);
	const before = await rubricRow(scenario.exam.id);
	const itemPk = { ...pk, key: "a" };
	const input = { children: [{ text: "Child", value: "0.25" }] };

	await failure(db.rubric.splitItem(itemPk, input, as(scenario, STALE)));
	expect((await itemRow(parentId)).retiredAt).toBeNull();
	expect(
		await prisma.rubricItem.count({ where: { rubricId: rubric.id } }),
	).toBe(3);

	await db.rubric.splitItem(itemPk, input, as(scenario, parent.updatedAt));
	const after = await itemRow(parentId);
	expect(after.retiredAt).not.toBeNull();
	expect(after.updatedAt.getTime()).toBeGreaterThan(parent.updatedAt.getTime());
	const moved = await itemRow(shiftedId);
	expect(moved.position).toBeGreaterThan(shifted.position);
	expect(moved.updatedAt.getTime()).toBeGreaterThan(
		shifted.updatedAt.getTime(),
	);
	expect(
		(await rubricRow(scenario.exam.id)).updatedAt.getTime(),
	).toBeGreaterThan(before.updatedAt.getTime());
});

test("rubric.renameGroup: the rubric version is checked; a rename moves the rubric and the items it renames, no match changes nothing", async () => {
	const { scenario, rubric, pk } = await rubricScenario();
	const before = await rubricRow(scenario.exam.id);
	const a = await itemRow(rubric.itemIds.a as number);
	const c = await itemRow(rubric.itemIds.c as number);

	await failure(
		db.rubric.renameGroup(pk, { from: "G", to: "H" }, as(scenario, STALE)),
	);
	expect((await itemRow(rubric.itemIds.a as number)).group).toBe("G/One");

	const none = await db.rubric.renameGroup(
		pk,
		{ from: "Nothing", to: "X" },
		as(scenario, before.updatedAt),
	);
	expect(none.renamed).toBe(0);
	expect((await rubricRow(scenario.exam.id)).updatedAt.getTime()).toBe(
		before.updatedAt.getTime(),
	);

	await db.rubric.renameGroup(
		pk,
		{ from: "G", to: "H" },
		as(scenario, before.updatedAt),
	);
	const after = await itemRow(rubric.itemIds.a as number);
	expect(after.group).toBe("H/One");
	expect(after.updatedAt.getTime()).toBeGreaterThan(a.updatedAt.getTime());
	expect((await itemRow(rubric.itemIds.c as number)).updatedAt.getTime()).toBe(
		c.updatedAt.getTime(),
	);
	expect(
		(await rubricRow(scenario.exam.id)).updatedAt.getTime(),
	).toBeGreaterThan(before.updatedAt.getTime());
});

//
// regradeRequest
//

/// A released exam with a graded answer and a regrade request on it.
async function regradeScenario() {
	const scenario = await createRubricScenario();
	const answer: ScenarioAnswer = await scenario.addAnswer();
	await db.feedback.create(
		{ submission: { id: answer.submission.id }, ref: GRADER_REF, score: "0" },
		as(scenario),
	);
	await scenario.release();
	const request = await db.regradeRequest.create(
		{
			course: scenario.course.id,
			submission: answer.submission.publicId,
			message: "I disagree with how this was graded.",
		},
		{ actor: answer.author },
	);
	return {
		scenario,
		answer,
		request,
		filter: { publicId: request.publicId },
		student: { actor: answer.author },
	};
}

test("regradeRequest.delete: right version deletes, stale throws and keeps it", async () => {
	const { scenario, answer, request, filter } = await regradeScenario();
	const asStudent = (v: Date) => ({
		actor: answer.author,
		expectedUpdatedAt: v,
	});

	const stale = await failure(
		db.regradeRequest.delete(filter, asStudent(STALE)),
	);
	expect(stale.updatedAt?.getTime()).toBe(request.updatedAt.getTime());
	expect(await prisma.regradeRequest.count({ where: { id: request.id } })).toBe(
		1,
	);

	await db.regradeRequest.delete(filter, asStudent(request.updatedAt));
	expect(await prisma.regradeRequest.count({ where: { id: request.id } })).toBe(
		0,
	);
	void scenario;
});

test("regradeRequest.delete: a Date on a missing request is a 412 with null, none is a NotFound", async () => {
	const { answer } = await regradeScenario();
	const filter = { publicId: "does-not-exist" };
	const err = await failure(
		db.regradeRequest.delete(filter, {
			actor: answer.author,
			expectedUpdatedAt: STALE,
		}),
	);
	expect(err.updatedAt).toBeNull();
	await expect(
		db.regradeRequest.delete(filter, { actor: answer.author }),
	).rejects.toBeInstanceOf(NotFound);
});

test("regradeRequest.accept: stale throws and writes nothing, right resolves and bumps", async () => {
	const { scenario, answer, request, filter } = await regradeScenario();
	const input = { score: "1", reply: "Fair point." };

	const stale = await failure(
		db.regradeRequest.accept(filter, input, as(scenario, STALE)),
	);
	expect(stale.updatedAt?.getTime()).toBe(request.updatedAt.getTime());
	expect((await requestRow(request.id)).status).toBe("OPEN");
	expect(
		await prisma.feedback.count({
			where: { submissionId: answer.submission.id },
		}),
	).toBe(1);

	const done = await db.regradeRequest.accept(
		filter,
		input,
		as(scenario, request.updatedAt),
	);
	expect(done.status).toBe("ACCEPTED");
	expect(done.updatedAt.getTime()).toBeGreaterThan(request.updatedAt.getTime());
});

test("regradeRequest.reject: stale throws and writes nothing, right resolves, absent expectation resolves", async () => {
	const { scenario, request, filter } = await regradeScenario();
	const input = { reply: "The grade stands." };

	await failure(db.regradeRequest.reject(filter, input, as(scenario, STALE)));
	expect((await requestRow(request.id)).status).toBe("OPEN");

	const done = await db.regradeRequest.reject(
		filter,
		input,
		as(scenario, request.updatedAt),
	);
	expect(done.status).toBe("REJECTED");
	expect(done.updatedAt.getTime()).toBeGreaterThan(request.updatedAt.getTime());

	const other = await regradeScenario();
	const open = await db.regradeRequest.reject(
		other.filter,
		input,
		as(other.scenario),
	);
	expect(open.status).toBe("REJECTED");
});

test("regradeRequest.accept and reject: a stale caller sees the 412, not the refusal of a request already resolved", async () => {
	const { scenario, request, filter } = await regradeScenario();
	const done = await db.regradeRequest.reject(
		filter,
		{ reply: "No." },
		as(scenario),
	);

	for (const run of [
		() =>
			db.regradeRequest.accept(
				filter,
				{ score: "1", reply: "x" },
				as(scenario, request.updatedAt),
			),
		() =>
			db.regradeRequest.reject(
				filter,
				{ reply: "x" },
				as(scenario, request.updatedAt),
			),
	]) {
		const err = await failure(run());
		expect(err.updatedAt?.getTime()).toBe(done.updatedAt.getTime());
	}
	// With the current version, or none, the refusal is the old one.
	await expect(
		db.regradeRequest.reject(
			filter,
			{ reply: "x" },
			as(scenario, done.updatedAt),
		),
	).rejects.toBeInstanceOf(InvalidData);
});

test("regradeRequest.accept: the pass it writes moves the response through the submission status", async () => {
	const { scenario, answer, filter } = await regradeScenario();
	await prisma.submission.update({
		where: { id: answer.submission.id },
		data: { status: "PENDING_GRADE" },
	});
	const before = await responseRow(answer.response.publicId);

	await db.regradeRequest.accept(
		filter,
		{ score: "1", reply: "Fair point." },
		as(scenario),
	);

	expect(
		(await responseRow(answer.response.publicId)).updatedAt.getTime(),
	).toBeGreaterThan(before.updatedAt.getTime());
});

// rubric read model

test("rubric read model: the rubric and its items carry the version a conditional write needs, null before the first copy", async () => {
	const { scenario, pk } = await rubricScenario();
	const row = await rubricRow(scenario.exam.id);
	const read = await db.rubric.findOne(pk, as(scenario));
	expect(read.updatedAt?.getTime()).toBe(row.updatedAt.getTime());
	const item = await prisma.rubricItem.findFirstOrThrow({
		where: { rubricId: row.id, key: "a" },
	});
	expect(
		read.items.find((entry) => entry.key === "a")?.updatedAt?.getTime(),
	).toBe(item.updatedAt.getTime());

	const fresh = await createRubricScenario({
		rubric: [{ value: "0.5", path: "G/One", text: "One" }],
	});
	const initial = await db.rubric.findOne(fresh.main.pk, as(fresh));
	expect(initial.initial).toBe(true);
	expect(initial.updatedAt).toBeNull();
	expect(initial.items.length).toBeGreaterThan(0);
	for (const entry of initial.items) expect(entry.updatedAt).toBeNull();

	// the version read is the one a conditional write accepts
	await db.rubric.update(pk, { base: "1" }, as(scenario, read.updatedAt));
});

test("submission refuses an expectation: its rows have no version to check", async () => {
	const scenario = await createRubricScenario();
	const answer = await scenario.addAnswer();
	const submission = { publicId: answer.submission.publicId };
	for (const expected of [new Date(), null]) {
		await expect(
			db.submission.update(
				submission,
				{ status: "WILL_NOT_GRADE" },
				as(scenario, expected),
			),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			db.submission.delete(submission, as(scenario, expected)),
		).rejects.toBeInstanceOf(InvalidData);
		await expect(
			db.submission.create(
				{
					response: answer.response,
					question: scenario.main.pk.question,
					payload: answer.submission.payload,
				},
				as(scenario, expected),
			),
		).rejects.toBeInstanceOf(InvalidData);
	}
	expect(
		(await db.submission.findOne(submission, as(scenario)))?.status,
	).not.toBe("WILL_NOT_GRADE");
});

// hidden rows answer as missing ones

test("feedback and regradeRequest: a row the actor may not read answers a Date as a missing one does, a 412 with null", async () => {
	const ctx = await regradeScenario();
	const stranger = await persistedUserFactory.create({ role: "STUDENT" });
	const strangerAs = (expected?: Date | null) => ({
		actor: {
			username: stranger.username,
			name: stranger.name,
			role: stranger.role,
		},
		...(expected === undefined ? {} : { expectedUpdatedAt: expected }),
	});
	const pass = await prisma.feedback.findFirstOrThrow({
		where: { submissionId: ctx.answer.submission.id },
	});
	const hiddenPass = { id: pass.id as FeedbackId };
	const absentPass = { id: 2_000_000_000 as FeedbackId };
	const hiddenRequest = { publicId: ctx.request.publicId };
	const absentRequest = { publicId: "nope-0000" };

	type Run = (
		target: "hidden" | "absent",
		expected?: Date | null,
	) => Promise<unknown>;
	const runs: Run[] = [
		(t, e) =>
			db.feedback.update(
				t === "hidden" ? hiddenPass : absentPass,
				{ notes: "x" },
				strangerAs(e),
			),
		(t, e) =>
			db.feedback.delete(
				t === "hidden" ? hiddenPass : absentPass,
				strangerAs(e),
			),
		(t, e) =>
			db.regradeRequest.reject(
				t === "hidden" ? hiddenRequest : absentRequest,
				{ reply: "x" },
				strangerAs(e),
			),
	];
	for (const run of runs) {
		expect((await failure(run("hidden", STALE))).updatedAt).toBeNull();
		expect((await failure(run("absent", STALE))).updatedAt).toBeNull();
		await expect(run("hidden")).rejects.toBeInstanceOf(NotFound);
		await expect(run("absent")).rejects.toBeInstanceOf(NotFound);
	}
});
