/**
 * The rubric service (spec `dev/specs/to-do/rubrica-de-correcao.md`, R1, R2,
 * R8 to R18), exposed as `db.rubric` (`src/db/services/rubric.service.ts`).
 *
 * API the tests expect. Every operation takes `opts` last (`{ actor }`); the
 * actor in these tests is the course's instructor.
 *
 *   PK        = { course: CourseRef; exam: string; question: string }
 *   ItemPK    = PK & { key: string }
 *
 *   findOne(pk): Promise<Rubric>                      (transaction: false)
 *     The stored rubric or, when none is stored, the initial one with
 *     `initial: true`, without writing. NotFound when the exam does not exist
 *     or does not carry the question.
 *   update(pk, { base }): Promise<Rubric>
 *   createItem(pk, { key?, group?, text, value, comment?, feedback? }): Promise<RubricItem>
 *   updateItem(itemPK, { group?, text?, value?, comment?, feedback? }): Promise<RubricItem>
 *   deleteItem(itemPK): Promise<void>                 (repeating it resolves)
 *   splitItem(itemPK, { children: ItemInput[] }): Promise<RubricItem[]>
 *     Returns the children. A child without `group` gets "<group>/<text>" of
 *     the old item ("<text>" when the old item has no group).
 *   renameGroup(pk, { from, to }): Promise<{ renamed: number; warnings: string[] }>
 *   preview(pk, change): Promise<{ passes: number; released: number }>
 *     change = { op: "update"; data: { base } }
 *            | { op: "updateItem"; key: string; data: ItemPatch }
 *            | { op: "deleteItem"; key: string }
 *
 *   Rubric     = { base: string; sourceVersion: string | null;
 *                  initial: boolean; review: number; items: RubricItem[] }
 *   RubricItem = { key; group: string | null; text; value;
 *                  comment: string | null; feedback: string | null;
 *                  position: number; retiredAt: Date | null; uses: number }
 *   Items come ordered by `position`.
 *
 * Errors: InvalidData for a duplicate key, a bad value or base, a bad group
 * path; NotFound for an unknown exam, question or item key. A refused write
 * leaves the database as it was, scores included.
 *
 * Rubrics and grading passes are arranged straight through `prisma`
 * (`src/fixtures/rubric-scenario.ts`), so these tests do not depend on the
 * feedback service accepting `rubric`.
 */
import { expect, test } from "@playwright/test";
import { InvalidData, NotFound } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	createRubricScenario,
	type RubricScenario,
	type ScenarioRubricPK,
	storedScore,
} from "@/fixtures/rubric-scenario";

/// Runs `body` while collecting what the code under test logs with `console.warn`.
async function collectingWarnings(
	body: () => Promise<void>,
): Promise<unknown[][]> {
	const warnings: unknown[][] = [];
	const original = console.warn;
	console.warn = (...args: unknown[]) => {
		warnings.push(args);
	};
	try {
		await body();
	} finally {
		console.warn = original;
	}
	return warnings;
}

function opts(scenario: RubricScenario) {
	return { actor: scenario.instructor };
}

function itemPK(pk: ScenarioRubricPK, key: string) {
	return { ...pk, key };
}

async function rubricRows(examId: number) {
	return prisma.rubric.findMany({
		where: { examId },
		include: { items: { orderBy: { position: "asc" } } },
	});
}

/// Everything the rubric tables and the grading passes of one exam hold, in a comparable form.
async function snapshot(examId: number) {
	const feedbackWhere = { submission: { response: { examId } } };
	return JSON.stringify({
		rubrics: await prisma.rubric.findMany({
			where: { examId },
			orderBy: { id: "asc" },
		}),
		items: await prisma.rubricItem.findMany({
			where: { rubric: { examId } },
			orderBy: { id: "asc" },
		}),
		feedbacks: await prisma.feedback.findMany({
			where: feedbackWhere,
			orderBy: { id: "asc" },
		}),
		links: await prisma.feedbackRubricItem.findMany({
			where: { feedback: feedbackWhere },
			orderBy: [{ feedbackId: "asc" }, { itemId: "asc" }],
		}),
	});
}

const initialRubric = [
	{ value: "0.5", path: "Rec/Right", text: "Base case", comment: "private" },
	{ value: "-0.25", text: "Late" },
];

//
// R12, R14: reading does not write; the first write copies
//

test("findOne returns the initial rubric flagged initial and writes nothing", async () => {
	const s = await createRubricScenario({ rubric: initialRubric });

	const first = await db.rubric.findOne(s.main.pk, opts(s));
	const second = await db.rubric.findOne(s.main.pk, opts(s));

	for (const rubric of [first, second]) {
		expect(rubric.initial).toBe(true);
		expect(rubric.base).toBe("0");
		expect(rubric.review).toBe(0);
		expect(
			rubric.items.map((i) => [i.key, i.group, i.text, i.value, i.uses]),
		).toEqual([
			["1", "Rec/Right", "Base case", "0.5", 0],
			["2", null, "Late", "-0.25", 0],
		]);
		expect(rubric.items[0]?.comment).toBe("private");
	}
	expect(await prisma.rubric.count({ where: { examId: s.exam.id } })).toBe(0);
});

test("findOne of a question without rubric is an empty initial rubric", async () => {
	const s = await createRubricScenario();

	const rubric = await db.rubric.findOne(s.main.pk, opts(s));

	expect(rubric).toMatchObject({ initial: true, base: "0", items: [] });
	expect(await prisma.rubric.count({ where: { examId: s.exam.id } })).toBe(0);
});

test("the first write copies the initial rubric, keeps its items and records the version", async () => {
	const s = await createRubricScenario({ rubric: initialRubric });

	const created = await db.rubric.createItem(
		s.main.pk,
		{ text: "Extra", value: "0.1" },
		opts(s),
	);

	expect(created.key).toBe("i1");
	const rows = await rubricRows(s.exam.id);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.sourceVersion).toBe("1");
	expect(rows[0]?.items.map((i) => [i.key, i.text])).toEqual([
		["1", "Base case"],
		["2", "Late"],
		["i1", "Extra"],
	]);
	const after = await db.rubric.findOne(s.main.pk, opts(s));
	expect(after.initial).toBe(false);
});

test("the copy takes the version the exam pins, or the latest when it pins none", async () => {
	const s = await createRubricScenario({
		pin: "1",
		rubric: [{ id: "a", value: "0.5", text: "From v1" }],
	});
	await s.pushQuestionVersion(s.main.slug, "2", [
		{ id: "b", value: "0.5", text: "From v2" },
	]);
	const latest = await s.addExam(null);

	await db.rubric.createItem(s.main.pk, { text: "New", value: "0.1" }, opts(s));
	await db.rubric.createItem(latest.pk, { text: "New", value: "0.1" }, opts(s));

	const pinned = await db.rubric.findOne(s.main.pk, opts(s));
	const following = await db.rubric.findOne(latest.pk, opts(s));
	expect(pinned.items.map((i) => i.text)).toEqual(["From v1", "New"]);
	expect(pinned.sourceVersion).toBe("1");
	expect(following.items.map((i) => i.text)).toEqual(["From v2", "New"]);
	expect(following.sourceVersion).toBe("2");
});

test("a question without initial rubric starts an empty rubric with a null source version", async () => {
	const s = await createRubricScenario();

	const rubric = await db.rubric.update(s.main.pk, { base: "1" }, opts(s));

	expect(rubric.base).toBe("1");
	expect(rubric.items).toEqual([]);
	expect(rubric.initial).toBe(false);
	const rows = await rubricRows(s.exam.id);
	expect(rows).toHaveLength(1);
	expect(rows[0]?.sourceVersion).toBeNull();
});

test("a push after the copy does not touch the stored rubric", async () => {
	const s = await createRubricScenario({
		rubric: [{ id: "a", value: "0.5", text: "Original" }],
	});
	await db.rubric.update(s.main.pk, { base: "0.1" }, opts(s));

	await s.pushQuestionVersion(s.main.slug, "2", [
		{ id: "z", value: "0.9", text: "Replaced" },
	]);

	const rubric = await db.rubric.findOne(s.main.pk, opts(s));
	expect(rubric.initial).toBe(false);
	expect(rubric.items.map((i) => i.text)).toEqual(["Original"]);
});

test("a malformed initial rubric is read as far as it goes, with a warning", async () => {
	const s = await createRubricScenario({
		rubric: [{ value: "0.5", text: "Good" }, { text: "No value" }],
	});

	const warnings = await collectingWarnings(async () => {
		const rubric = await db.rubric.findOne(s.main.pk, opts(s));
		expect(rubric.items.map((i) => i.text)).toEqual(["Good"]);
		await db.rubric.createItem(
			s.main.pk,
			{ text: "Extra", value: "0.1" },
			opts(s),
		);
	});

	expect(warnings.length).toBeGreaterThan(0);
	const rows = await rubricRows(s.exam.id);
	expect(rows[0]?.items.map((i) => i.text)).toEqual(["Good", "Extra"]);
});

test("an initial rubric that is not a list reads as empty and does not break the first write", async () => {
	const s = await createRubricScenario({ rubric: { not: "a list" } });

	const warnings = await collectingWarnings(async () => {
		expect((await db.rubric.findOne(s.main.pk, opts(s))).items).toEqual([]);
		await db.rubric.update(s.main.pk, { base: "0.2" }, opts(s));
	});

	expect(warnings.length).toBeGreaterThan(0);
	expect((await rubricRows(s.exam.id))[0]?.items).toEqual([]);
});

//
// R2, R15: keys
//

test("a generated key goes one above the highest i<n>, other keys ignored", async () => {
	const s = await createRubricScenario();
	await db.rubric.createItem(
		s.main.pk,
		{ key: "i1", text: "a", value: "0.1" },
		opts(s),
	);
	await db.rubric.createItem(
		s.main.pk,
		{ key: "i3", text: "b", value: "0.1" },
		opts(s),
	);
	await db.rubric.createItem(
		s.main.pk,
		{ key: "foo", text: "c", value: "0.1" },
		opts(s),
	);

	const generated = await db.rubric.createItem(
		s.main.pk,
		{ text: "d", value: "0.1" },
		opts(s),
	);

	expect(generated.key).toBe("i4");
});

test("a retired key counts for the generated key, and split children take the next ones", async () => {
	const s = await createRubricScenario();
	await db.rubric.createItem(
		s.main.pk,
		{ key: "i5", text: "old", value: "-0.5" },
		opts(s),
	);

	const children = await db.rubric.splitItem(
		itemPK(s.main.pk, "i5"),
		{
			children: [
				{ text: "x", value: "-0.25" },
				{ text: "y", value: "-0.25" },
			],
		},
		opts(s),
	);
	const next = await db.rubric.createItem(
		s.main.pk,
		{ text: "z", value: "0.1" },
		opts(s),
	);

	expect(children.map((c) => c.key)).toEqual(["i6", "i7"]);
	expect(next.key).toBe("i8");
});

test("a deleted key is not handed out again by chance but is accepted when sent", async () => {
	const s = await createRubricScenario();
	for (const key of ["i1", "i2", "i3"]) {
		await db.rubric.createItem(
			s.main.pk,
			{ key, text: key, value: "0.1" },
			opts(s),
		);
	}
	await db.rubric.deleteItem(itemPK(s.main.pk, "i2"), opts(s));

	const generated = await db.rubric.createItem(
		s.main.pk,
		{ text: "gen", value: "0.1" },
		opts(s),
	);
	const reused = await db.rubric.createItem(
		s.main.pk,
		{ key: "i2", text: "back", value: "0.1" },
		opts(s),
	);

	expect(generated.key).toBe("i4");
	expect(reused.key).toBe("i2");
});

test("createItem refuses a key already in use, active or retired, and writes nothing", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({
		items: [
			{ key: "1", value: "0.5" },
			{ key: "2", value: "0.5", retired: true },
		],
	});
	const before = await snapshot(s.exam.id);

	for (const key of ["1", "2"]) {
		await expect(
			db.rubric.createItem(
				s.main.pk,
				{ key, text: "dup", value: "0.1" },
				opts(s),
			),
		).rejects.toBeInstanceOf(InvalidData);
	}

	expect(await snapshot(s.exam.id)).toBe(before);
});

test("a refused first write leaves no rubric behind", async () => {
	const s = await createRubricScenario({
		rubric: [{ value: "0.5", text: "Good" }],
	});

	await expect(
		db.rubric.createItem(
			s.main.pk,
			{ key: "1", text: "dup", value: "0.1" },
			opts(s),
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(await prisma.rubric.count({ where: { examId: s.exam.id } })).toBe(0);
});

//
// R8: recalculation
//

/// A rubric with base 0.2 and items a (0.5) and b (-0.25).
async function recomputeFixture() {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		base: "0.2",
		items: [
			{ key: "a", value: "0.5" },
			{ key: "b", value: "-0.25" },
		],
	});
	const answer = await s.addAnswer();
	return { s, rubric, answer };
}

test("a base change recomputes every pass of the rubric, empty and adjusted ones included", async () => {
	const { s, rubric, answer } = await recomputeFixture();
	const both = await s.seedPass(answer, rubric, {
		ref: "p1",
		keys: ["a", "b"],
		score: "0.45",
	});
	const empty = await s.seedPass(answer, rubric, {
		ref: "p2",
		keys: [],
		score: "0.2",
	});
	const adjusted = await s.seedPass(answer, rubric, {
		ref: "p3",
		keys: ["a"],
		score: "0.8",
		adjustment: "0.1",
	});

	await db.rubric.update(s.main.pk, { base: "0.4" }, opts(s));

	expect(await storedScore(both)).toBe("0.65");
	expect(await storedScore(empty)).toBe("0.4");
	expect(await storedScore(adjusted)).toBe("1");
});

test("a value change recomputes the passes that apply the item and leaves the others", async () => {
	const { s, rubric, answer } = await recomputeFixture();
	const uses = await s.seedPass(answer, rubric, {
		ref: "p1",
		keys: ["a"],
		score: "0.7",
	});
	const other = await s.seedPass(answer, rubric, {
		ref: "p2",
		keys: ["b"],
		score: "0",
	});

	await db.rubric.updateItem(
		itemPK(s.main.pk, "a"),
		{ value: "0.25" },
		opts(s),
	);

	expect(await storedScore(uses)).toBe("0.45");
	expect(await storedScore(other)).toBe("0");
});

test("a recalculation leaves manual passes alone", async () => {
	const { s, rubric, answer } = await recomputeFixture();
	await s.seedPass(answer, rubric, { ref: "p1", keys: ["a"], score: "0.7" });
	const manual = await db.feedback.create(
		{ submission: { id: answer.submission.id }, ref: "manual", score: "0.33" },
		opts(s),
	);

	await db.rubric.update(s.main.pk, { base: "0.5" }, opts(s));

	expect(await storedScore(manual.id)).toBe("0.33");
});

test("a recalculation stays inside the rubric of its own question", async () => {
	const s = await createRubricScenario({ siblings: [{}] });
	const sibling = s.siblings[0];
	if (!sibling) throw new Error("no sibling");
	const mainRubric = await s.seedRubric({
		base: "0.2",
		items: [{ key: "a", value: "0.5" }],
	});
	const siblingRubric = await s.seedRubric({
		question: sibling.slug,
		base: "0.2",
		items: [{ key: "a", value: "0.5" }],
	});
	const mainAnswer = await s.addAnswer();
	const siblingAnswer = await s.addAnswer(sibling.slug);
	const mainPass = await s.seedPass(mainAnswer, mainRubric, {
		ref: "p",
		keys: ["a"],
		score: "0.7",
	});
	const siblingPass = await s.seedPass(siblingAnswer, siblingRubric, {
		ref: "p",
		keys: ["a"],
		score: "0.7",
	});

	await db.rubric.update(s.main.pk, { base: "0" }, opts(s));
	await db.rubric.updateItem(
		itemPK(s.main.pk, "a"),
		{ value: "0.25" },
		opts(s),
	);

	expect(await storedScore(mainPass)).toBe("0.25");
	expect(await storedScore(siblingPass)).toBe("0.7");
});

test("deleting an applied item unlinks it from every pass and recomputes them; repeating the delete resolves", async () => {
	const { s, rubric, answer } = await recomputeFixture();
	const other = await s.addAnswer();
	const p1 = await s.seedPass(answer, rubric, {
		ref: "p1",
		keys: ["a", "b"],
		score: "0.45",
	});
	const p2 = await s.seedPass(other, rubric, {
		ref: "p2",
		keys: ["a"],
		score: "0.7",
	});

	await db.rubric.deleteItem(itemPK(s.main.pk, "a"), opts(s));
	await expect(
		db.rubric.deleteItem(itemPK(s.main.pk, "a"), opts(s)),
	).resolves.toBeUndefined();

	// 0.2 - 0.25 is below zero: clamped.
	expect(await storedScore(p1)).toBe("0");
	expect(await storedScore(p2)).toBe("0.2");
	const links = await prisma.feedbackRubricItem.findMany({
		where: { feedbackId: { in: [p1, p2] } },
	});
	expect(links.map((l) => l.itemId)).toEqual([rubric.itemIds.b]);
	expect(
		(await db.rubric.findOne(s.main.pk, opts(s))).items.map((i) => i.key),
	).toEqual(["b"]);
});

test("a change that fails validation is rejected and moves no score", async () => {
	const { s, rubric, answer } = await recomputeFixture();
	const pass = await s.seedPass(answer, rubric, {
		ref: "p1",
		keys: ["a"],
		score: "0.7",
	});
	const before = await snapshot(s.exam.id);

	await expect(
		db.rubric.updateItem(itemPK(s.main.pk, "a"), { value: "2" }, opts(s)),
	).rejects.toBeInstanceOf(InvalidData);
	await expect(
		db.rubric.update(s.main.pk, { base: "-0.1" }, opts(s)),
	).rejects.toBeInstanceOf(InvalidData);
	await expect(
		db.rubric.update(s.main.pk, { base: "1.5" }, opts(s)),
	).rejects.toBeInstanceOf(InvalidData);

	expect(await storedScore(pass)).toBe("0.7");
	expect(await snapshot(s.exam.id)).toBe(before);
});

test("updateItem on an unknown key is NotFound", async () => {
	const { s } = await recomputeFixture();

	await expect(
		db.rubric.updateItem(itemPK(s.main.pk, "nope"), { text: "x" }, opts(s)),
	).rejects.toBeInstanceOf(NotFound);
});

test("a change is allowed after the grades are released and recomputes the passes", async () => {
	const { s, rubric, answer } = await recomputeFixture();
	const pass = await s.seedPass(answer, rubric, {
		ref: "p1",
		keys: ["a"],
		score: "0.7",
	});
	await s.release();

	await db.rubric.updateItem(itemPK(s.main.pk, "a"), { value: "0.3" }, opts(s));

	expect(await storedScore(pass)).toBe("0.5");
});

//
// R10, R11, R14, R16: split and review
//

test("splitItem retires the item, creates children under '<group>/<text>', keeps the score and flags review", async () => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [
			{ key: "r", group: "Rec", text: "Wrong", value: "-0.5" },
			{ key: "keep", value: "0.5" },
		],
	});
	const answer = await s.addAnswer();
	const pass = await s.seedPass(answer, rubric, {
		ref: "p",
		keys: ["r", "keep"],
		score: "0",
	});
	await s.close();

	const children = await db.rubric.splitItem(
		itemPK(s.main.pk, "r"),
		{
			children: [
				{ text: "No base case", value: "-0.5" },
				{ text: "Infinite loop", value: "-0.25" },
			],
		},
		opts(s),
	);

	expect(children).toHaveLength(2);
	expect(children.map((c) => c.group)).toEqual(["Rec/Wrong", "Rec/Wrong"]);
	expect(children.map((c) => c.retiredAt)).toEqual([null, null]);
	const after = await db.rubric.findOne(s.main.pk, opts(s));
	const parent = after.items.find((i) => i.key === "r");
	expect(parent?.retiredAt).toBeInstanceOf(Date);
	expect(parent?.uses).toBe(1);
	expect(after.review).toBe(1);
	expect(await storedScore(pass)).toBe("0");
	expect(
		await prisma.feedbackRubricItem.count({ where: { feedbackId: pass } }),
	).toBe(2);
});

test("splitItem keeps a group the caller gives the children", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({
		items: [{ key: "r", group: "Rec", text: "Wrong", value: "-0.5" }],
	});

	const children = await db.rubric.splitItem(
		itemPK(s.main.pk, "r"),
		{ children: [{ group: "Rec/Other", text: "x", value: "-0.5" }] },
		opts(s),
	);

	expect(children[0]?.group).toBe("Rec/Other");
});

test("splitting an ungrouped item puts the children under its text", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({
		items: [{ key: "st", group: null, text: "Style", value: "-0.2" }],
	});

	const children = await db.rubric.splitItem(
		itemPK(s.main.pk, "st"),
		{
			children: [
				{ text: "Naming", value: "-0.1" },
				{ text: "Layout", value: "-0.1" },
			],
		},
		opts(s),
	);

	expect(children.map((c) => c.group)).toEqual(["Style", "Style"]);
});

/// Item `old` (retired) and `fresh`, one answer in a closed exam.
async function reviewFixture() {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [
			{ key: "old", group: "G", text: "Old", value: "-0.5", retired: true },
			{ key: "fresh", group: "G", text: "Fresh", value: "-0.25" },
		],
	});
	return { s, rubric };
}

const T1 = new Date("2026-03-01T10:00:00Z");
const T2 = new Date("2026-03-01T11:00:00Z");

test("review counts the newest pass of the counting answer: a newer clean pass clears it", async () => {
	const { s, rubric } = await reviewFixture();
	const answer = await s.addAnswer();
	await s.seedPass(answer, rubric, {
		ref: "older",
		keys: ["old"],
		score: "0.5",
		updatedAt: T1,
	});
	await s.seedPass(answer, rubric, {
		ref: "newer",
		keys: ["fresh"],
		score: "0.75",
		updatedAt: T2,
	});

	await s.close();

	expect((await db.rubric.findOne(s.main.pk, opts(s))).review).toBe(0);
});

test("review counts the newest pass of the counting answer: a newer pass on a retired item raises it", async () => {
	const { s, rubric } = await reviewFixture();
	const answer = await s.addAnswer();
	await s.seedPass(answer, rubric, {
		ref: "older",
		keys: ["fresh"],
		score: "0.75",
		updatedAt: T1,
	});
	await s.seedPass(answer, rubric, {
		ref: "newer",
		keys: ["old"],
		score: "0.5",
		updatedAt: T2,
	});

	await s.close();

	expect((await db.rubric.findOne(s.main.pk, opts(s))).review).toBe(1);
});

test("review ignores a superseded submission: only the newest submission of the attempt counts", async () => {
	const { s, rubric } = await reviewFixture();
	const answer = await s.addAnswer();
	const newest = await s.addSubmission(answer);
	// The first submission is superseded by `newest`.
	await s.seedPass(answer, rubric, {
		ref: "stale",
		keys: ["old"],
		score: "0.5",
	});
	await prisma.feedback.create({
		data: {
			submissionId: newest.id,
			ref: "clean",
			score: "0.75",
			graderId: s.instructor.username,
			rubricId: rubric.id,
			rubricItems: { create: [{ itemId: rubric.itemIds.fresh as number }] },
		},
	});

	await s.close();

	expect((await db.rubric.findOne(s.main.pk, opts(s))).review).toBe(0);
});

test("review counts one per counting answer", async () => {
	const { s, rubric } = await reviewFixture();
	for (let i = 0; i < 2; i++) {
		const answer = await s.addAnswer();
		await s.seedPass(answer, rubric, {
			ref: "p",
			keys: ["old"],
			score: "0.5",
		});
	}
	const clean = await s.addAnswer();
	await s.seedPass(clean, rubric, { ref: "p", keys: ["fresh"], score: "0.75" });

	await s.close();

	expect((await db.rubric.findOne(s.main.pk, opts(s))).review).toBe(2);
});

//
// R17: renameGroup
//

test("renameGroup replaces the prefix in the group and its subgroups, not in lookalikes", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({
		items: [
			{ key: "a", group: "Rec", value: "0.1" },
			{ key: "b", group: "Rec/Wrong", value: "0.1" },
			{ key: "c", group: "Rec/Wrong/Base", value: "0.1" },
			{ key: "d", group: "Recursion/x", value: "0.1" },
			{ key: "e", group: "RecX", value: "0.1" },
			{ key: "f", group: null, value: "0.1" },
		],
	});

	const result = await db.rubric.renameGroup(
		s.main.pk,
		{ from: "Rec", to: "Recursão" },
		opts(s),
	);

	expect(result.renamed).toBe(3);
	expect(result.warnings).toEqual([]);
	const rubric = await db.rubric.findOne(s.main.pk, opts(s));
	expect(rubric.items.map((i) => i.group)).toEqual([
		"Recursão",
		"Recursão/Wrong",
		"Recursão/Wrong/Base",
		"Recursion/x",
		"RecX",
		null,
	]);
});

test("renameGroup to a name that differs from an existing group only by case or spaces warns but renames", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({
		items: [
			{ key: "a", group: "Recursion", value: "0.1" },
			{ key: "b", group: "Rec", value: "0.1" },
		],
	});

	const result = await db.rubric.renameGroup(
		s.main.pk,
		{ from: "Rec", to: " recursion " },
		opts(s),
	);

	expect(result.warnings).toHaveLength(1);
	const rubric = await db.rubric.findOne(s.main.pk, opts(s));
	expect(rubric.items.map((i) => i.group)).toEqual(["Recursion", "recursion"]);
});

test("renameGroup keeps the applied items and the scores", async () => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [{ key: "a", group: "Rec/Wrong", value: "0.5" }],
	});
	const answer = await s.addAnswer();
	const pass = await s.seedPass(answer, rubric, {
		ref: "p",
		keys: ["a"],
		score: "0.5",
	});

	await db.rubric.renameGroup(s.main.pk, { from: "Rec", to: "R" }, opts(s));

	expect(await storedScore(pass)).toBe("0.5");
	expect(
		await prisma.feedbackRubricItem.count({ where: { feedbackId: pass } }),
	).toBe(1);
});

test("renameGroup rejects a destination that is not a valid path", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({ items: [{ key: "a", group: "Rec", value: "0.5" }] });

	await expect(
		db.rubric.renameGroup(s.main.pk, { from: "Rec", to: "A//B" }, opts(s)),
	).rejects.toBeInstanceOf(InvalidData);
});

//
// R9, R12, R18: preview
//

/// base 0, a (0.5), b (0.25); passes: {a}, {a, b}, {b}. Returns the scenario.
async function previewFixture() {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [
			{ key: "a", value: "0.5" },
			{ key: "b", value: "0.25" },
		],
	});
	const keysets = [["a"], ["a", "b"], ["b"]];
	const scores = ["0.5", "0.75", "0.25"];
	for (const [i, keys] of keysets.entries()) {
		const answer = await s.addAnswer();
		await s.seedPass(answer, rubric, {
			ref: "p",
			keys,
			score: scores[i] as string,
		});
	}
	await s.close();
	return s;
}

test("preview counts the passes whose score changes and the released ones, and changes nothing", async () => {
	const s = await previewFixture();
	await s.release();
	const before = await snapshot(s.exam.id);

	const del = await db.rubric.preview(
		s.main.pk,
		{ op: "deleteItem", key: "a" },
		opts(s),
	);
	const base = await db.rubric.preview(
		s.main.pk,
		{ op: "update", data: { base: "0.1" } },
		opts(s),
	);
	const value = await db.rubric.preview(
		s.main.pk,
		{ op: "updateItem", key: "b", data: { value: "0.5" } },
		opts(s),
	);

	expect(del).toEqual({ passes: 2, released: 2 });
	expect(base).toEqual({ passes: 3, released: 3 });
	expect(value).toEqual({ passes: 2, released: 2 });
	expect(await snapshot(s.exam.id)).toBe(before);
});

test("preview counts none as released while the exam has not released its grades", async () => {
	const s = await previewFixture();

	const result = await db.rubric.preview(
		s.main.pk,
		{ op: "deleteItem", key: "a" },
		opts(s),
	);

	expect(result).toEqual({ passes: 2, released: 0 });
});

test("preview of a change that clamps to the same score does not count the pass", async () => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		base: "1",
		items: [{ key: "a", value: "0.5" }],
	});
	const answer = await s.addAnswer();
	await s.seedPass(answer, rubric, { ref: "p", keys: ["a"], score: "1" });

	const result = await db.rubric.preview(
		s.main.pk,
		{ op: "updateItem", key: "a", data: { value: "0.25" } },
		opts(s),
	);

	expect(result.passes).toBe(0);
});

test("preview does not materialize the initial rubric", async () => {
	const s = await createRubricScenario({ rubric: initialRubric });

	const result = await db.rubric.preview(
		s.main.pk,
		{ op: "update", data: { base: "0.5" } },
		opts(s),
	);
	await db.rubric.preview(s.main.pk, { op: "deleteItem", key: "1" }, opts(s));

	expect(result).toEqual({ passes: 0, released: 0 });
	expect(await prisma.rubric.count({ where: { examId: s.exam.id } })).toBe(0);
});

//
// R1: the rubric belongs to the exam and the question, not to QuestionsForExam
//

test("an exam push rewrites the question rows but keeps the rubric, its items and its links", async () => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [{ key: "a", value: "0.5" }],
	});
	const answer = await s.addAnswer();
	const pass = await s.seedPass(answer, rubric, {
		ref: "p",
		keys: ["a"],
		score: "0.5",
	});

	await s.repushExam();

	const rows = await rubricRows(s.exam.id);
	expect(rows.map((r) => r.id)).toEqual([rubric.id]);
	expect(rows[0]?.items).toHaveLength(1);
	expect(
		await prisma.feedbackRubricItem.count({ where: { feedbackId: pass } }),
	).toBe(1);
	const found = await db.rubric.findOne(s.main.pk, opts(s));
	expect(found.initial).toBe(false);
	expect(found.items.map((i) => i.key)).toEqual(["a"]);
});

test("a question dropped from the exam keeps its rubric row, but the service no longer finds it", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({ items: [{ key: "a", value: "0.5" }] });

	await s.repushExam([]);

	expect(await prisma.rubric.count({ where: { examId: s.exam.id } })).toBe(1);
	await expect(db.rubric.findOne(s.main.pk, opts(s))).rejects.toBeInstanceOf(
		NotFound,
	);
});

test("a question of the course that the exam never carried is NotFound, on reads and writes, and writes nothing", async () => {
	const s = await createRubricScenario({ siblings: [{}] });
	const stranger = s.siblings[0];
	if (!stranger) throw new Error("no sibling");
	await s.repushExam([s.main.slug]);

	await expect(db.rubric.findOne(stranger.pk, opts(s))).rejects.toBeInstanceOf(
		NotFound,
	);
	await expect(
		db.rubric.createItem(stranger.pk, { text: "x", value: "0.1" }, opts(s)),
	).rejects.toBeInstanceOf(NotFound);
	expect(await prisma.rubric.count({ where: { examId: s.exam.id } })).toBe(0);
});
