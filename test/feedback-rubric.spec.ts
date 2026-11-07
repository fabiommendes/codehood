/**
 * Grading passes made with a rubric (spec
 * `dev/specs/to-do/rubrica-de-correcao.md`, R6, R7, R10, R11, R19, R19a, R20),
 * through the existing `db.feedback` service.
 *
 * API the tests expect, as additions to `feedbackCreate` / `feedbackUpdate`
 * (and `upsert`, which takes the create shape):
 *
 *   rubric?: string[]       keys of the applied items of the rubric of the
 *                           submission's question in its exam
 *   adjustment?: string | null   signed decimal or "n/d", added after the items
 *   score                   becomes optional on create; sending it together
 *                           with `rubric` is InvalidData
 *
 *   With `rubric` the service materializes the rubric (R12), computes `score`
 *   exactly (R7, R19a) and stores `rubricId` and the applied items.
 *   `rubric: []` is a rubric pass without items (base + adjustment).
 *   InvalidData (nothing written) for: `score` together with `rubric`, an
 *   unknown key, a key of another question's rubric, a retired key the pass
 *   did not already apply, two items in one top-level group.
 *   `update` with `score` and no `rubric` makes the pass manual: clears
 *   rubricId, items and adjustment. `update` with only `adjustment` or
 *   `feedback` keeps the items and recomputes.
 *
 * Output (`Feedback`) gains:
 *   rubric: string[] | null        applied keys (null for a manual pass)
 *   adjustment: string | null
 *   review: boolean                the pass applies a retired item
 *   rubricItems: RubricApplied[] | null
 *       the applied items, ordered by position. For a grader:
 *         { key, group, text, value, comment, feedback }.
 *       For the graded student (only once the exam releases, as today):
 *         { group, text, value, feedback } and nothing else.
 *       null for a manual pass.
 *
 * The rubrics are arranged straight through `prisma`
 * (`src/fixtures/rubric-scenario.ts`).
 */
import { expect, test } from "@playwright/test";
import { SYSTEM } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	createRubricScenario,
	type RubricScenario,
	type ScenarioAnswer,
	storedScore,
} from "@/fixtures/rubric-scenario";

function opts(scenario: RubricScenario) {
	return { actor: scenario.instructor };
}

/// A pass that is not valid until the service accepts `rubric`; the cast marks the test as ahead of the types.
type RubricPassInput = Parameters<typeof db.feedback.create>[0] & {
	rubric?: string[];
	adjustment?: string | null;
};

function pass(
	answer: ScenarioAnswer,
	ref: string,
	extra: Record<string, unknown>,
): RubricPassInput {
	return { submission: { id: answer.submission.id }, ref, ...extra } as never;
}

async function passesOf(answer: ScenarioAnswer) {
	return prisma.feedback.findMany({
		where: { submissionId: answer.submission.id },
		include: { rubricItems: true },
	});
}

/// base 0; k1 0.5, k2 1/4 (ungrouped) and Rec/Wrong/Base, Rec/Right (same top-level group).
const standardItems = [
	{ key: "k1", value: "0.5" },
	{ key: "k2", value: "1/4" },
	{ key: "wb", group: "Rec/Wrong/Base", value: "-0.5" },
	{ key: "r", group: "Rec/Right", value: "0.5" },
	{ key: "old", group: "Old", text: "Retired", value: "-0.5", retired: true },
];

async function standard(
	options: Parameters<typeof createRubricScenario>[0] = {},
) {
	const s = await createRubricScenario(options);
	const rubric = await s.seedRubric({ items: standardItems });
	const answer = await s.addAnswer();
	return { s, rubric, answer };
}

/// Proves the service accepts a valid rubric pass, so a refusal below is about the input and not about the feature being absent.
async function expectRubricPassesAccepted(s: RubricScenario) {
	const other = await s.addAnswer();
	const created = await db.feedback.create(
		pass(other, "control", { rubric: ["k1"] }),
		opts(s),
	);
	expect(created.score).toBe("0.5");
}

//
// R7, R19, R19a, R20: score computed from the items
//

test("create with rubric computes the score exactly, stores the rubric and reports the items", async () => {
	const { s, rubric, answer } = await standard();

	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["k1", "k2"], adjustment: "0.1" }),
		opts(s),
	);

	expect(created.score).toBe("0.85");
	expect([...(created.rubric ?? [])].sort()).toEqual(["k1", "k2"]);
	expect(created.adjustment).toBe("0.1");
	expect(created.review).toBe(false);
	const [row] = await passesOf(answer);
	expect(row?.rubricId).toBe(rubric.id);
	expect(row?.score).toBe("0.85");
	expect(row?.rubricItems).toHaveLength(2);
});

test("create with rubric keeps fractions exact", async () => {
	const s = await createRubricScenario();
	await s.seedRubric({
		items: [
			{ key: "a", value: "1/3" },
			{ key: "b", value: "1/3" },
		],
	});
	const answer = await s.addAnswer();

	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["a", "b"] }),
		opts(s),
	);

	expect(created.score).toBe("2/3");
});

test("create with an empty rubric is a rubric pass worth the base plus the adjustment", async () => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({ base: "0.2", items: [] });
	const answer = await s.addAnswer();

	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: [], adjustment: "0.3" }),
		opts(s),
	);

	expect(created.score).toBe("0.5");
	expect(created.rubric).toEqual([]);
	expect((await passesOf(answer))[0]?.rubricId).toBe(rubric.id);
});

test("create with rubric clamps the score to [0, 1]", async () => {
	const { s, answer } = await standard();

	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["k1", "r"], adjustment: "0.5" }),
		opts(s),
	);

	expect(created.score).toBe("1");
});

test("create with rubric materializes the initial rubric of the question", async () => {
	const s = await createRubricScenario({
		rubric: [{ id: "good", value: "0.5", text: "Good" }],
	});
	const answer = await s.addAnswer();
	expect(await prisma.rubric.count({ where: { examId: s.exam.id } })).toBe(0);

	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["good"] }),
		opts(s),
	);

	expect(created.score).toBe("0.5");
	const rubrics = await prisma.rubric.findMany({
		where: { examId: s.exam.id },
		include: { items: true },
	});
	expect(rubrics).toHaveLength(1);
	expect(rubrics[0]?.sourceVersion).toBe("1");
	expect(rubrics[0]?.items.map((i) => i.key)).toEqual(["good"]);
	expect((await passesOf(answer))[0]?.rubricId).toBe(rubrics[0]?.id);
});

test("a rubric key without id in the initial rubric is its position", async () => {
	const s = await createRubricScenario({
		rubric: [{ value: "0.25", text: "First" }],
	});
	const answer = await s.addAnswer();

	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["1"] }),
		opts(s),
	);

	expect(created.score).toBe("0.25");
});

//
// R19: refusals
//

test("score together with rubric is refused on create and on update, and nothing is written", async () => {
	const { s, answer } = await standard();

	await expect(
		db.feedback.create(
			pass(answer, "r1", { score: "0.5", rubric: ["k1"] }),
			opts(s),
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await passesOf(answer)).toEqual([]);

	const manual = await db.feedback.create(
		pass(answer, "m", { score: "0.3" }),
		opts(s),
	);
	await expect(
		db.feedback.update(
			{ id: manual.id },
			{ score: "0.5", rubric: ["k1"] } as never,
			opts(s),
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await storedScore(manual.id)).toBe("0.3");
});

test("an unknown key is refused", async () => {
	const { s, answer } = await standard();
	await expectRubricPassesAccepted(s);

	await expect(
		db.feedback.create(pass(answer, "r1", { rubric: ["nope"] }), opts(s)),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await passesOf(answer)).toEqual([]);
});

test("a key that exists only in another question's rubric is refused", async () => {
	const s = await createRubricScenario({ siblings: [{}] });
	const sibling = s.siblings[0];
	if (!sibling) throw new Error("no sibling");
	await s.seedRubric({ items: [{ key: "k1", value: "0.5" }] });
	await s.seedRubric({
		question: sibling.slug,
		items: [{ key: "only-sibling", value: "0.5" }],
	});
	await expectRubricPassesAccepted(s);
	const answer = await s.addAnswer();

	await expect(
		db.feedback.create(
			pass(answer, "r1", { rubric: ["only-sibling"] }),
			opts(s),
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await passesOf(answer)).toEqual([]);
});

test("a retired key is refused on a new pass", async () => {
	const { s, answer } = await standard();
	await expectRubricPassesAccepted(s);

	await expect(
		db.feedback.create(pass(answer, "r1", { rubric: ["old"] }), opts(s)),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await passesOf(answer)).toEqual([]);
});

test("a retired key the pass did not already apply is refused on update", async () => {
	const { s, answer } = await standard();
	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["k1"] }),
		opts(s),
	);

	await expect(
		db.feedback.update(
			{ id: created.id },
			{ rubric: ["k1", "old"] } as never,
			opts(s),
		),
	).rejects.toBeInstanceOf(InvalidData);

	const [row] = await passesOf(answer);
	expect(row?.rubricItems).toHaveLength(1);
	expect(row?.score).toBe("0.5");
});

test("two items in one top-level group are refused, at any depth", async () => {
	const { s, answer } = await standard();
	await expectRubricPassesAccepted(s);

	await expect(
		db.feedback.create(pass(answer, "r1", { rubric: ["wb", "r"] }), opts(s)),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await passesOf(answer)).toEqual([]);

	const created = await db.feedback.create(
		pass(answer, "r2", { rubric: ["wb"] }),
		opts(s),
	);
	await expect(
		db.feedback.update(
			{ id: created.id },
			{ rubric: ["wb", "r"] } as never,
			opts(s),
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await storedScore(created.id)).toBe("0");
});

test("one item from each of two groups, and ungrouped items beside them, are accepted", async () => {
	const { s, answer } = await standard();

	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["r", "k1", "k2"] }),
		opts(s),
	);

	expect(created.score).toBe("1");
});

//
// R10, R11, R19: review
//

/// An item `parent` that was split into `child`, a pass applying the parent, an exam already closed.
async function reviewPass() {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [
			{
				key: "parent",
				group: "Rec",
				text: "Wrong",
				value: "-0.5",
				retired: true,
			},
			{ key: "child", group: "Rec/Wrong", text: "No base", value: "-0.25" },
			{ key: "other", value: "0.75" },
		],
	});
	const answer = await s.addAnswer();
	const seeded = await s.seedPass(answer, rubric, {
		ref: "p",
		keys: ["parent", "other"],
		score: "0.25",
	});
	await s.close();
	return { s, answer, seeded };
}

test("a pass applying a retired item reports review, and the rubric counts it", async () => {
	const { s, seeded } = await reviewPass();

	const found = await db.feedback.findOne({ id: seeded }, opts(s));

	expect(found?.review).toBe(true);
	expect((await db.rubric.findOne(s.main.pk, opts(s))).review).toBe(1);
});

test("regrading with a live item clears review, recomputes the score and drops the rubric count", async () => {
	const { s, seeded } = await reviewPass();

	const updated = await db.feedback.update(
		{ id: seeded },
		{ rubric: ["child", "other"] } as never,
		opts(s),
	);

	expect(updated.review).toBe(false);
	expect(updated.score).toBe("0.5");
	expect(await storedScore(seeded)).toBe("0.5");
	expect((await db.rubric.findOne(s.main.pk, opts(s))).review).toBe(0);
});

test("resending a retired key the pass already applies is accepted, stays in review and recomputes", async () => {
	const { s, seeded } = await reviewPass();

	const updated = await db.feedback.update(
		{ id: seeded },
		{ rubric: ["parent", "other"], adjustment: "0.1" } as never,
		opts(s),
	);

	expect(updated.review).toBe(true);
	expect(updated.score).toBe("0.35");
	expect(updated.adjustment).toBe("0.1");
});

//
// R19: update, manual passes, upsert
//

test("update with only adjustment or feedback keeps the items and recomputes", async () => {
	const { s, answer } = await standard();
	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["k1"], adjustment: "0.1" }),
		opts(s),
	);
	expect(created.score).toBe("0.6");

	const adjusted = await db.feedback.update(
		{ id: created.id },
		{ adjustment: "0.2" } as never,
		opts(s),
	);
	expect(adjusted.rubric).toEqual(["k1"]);
	expect(adjusted.score).toBe("0.7");

	const commented = await db.feedback.update(
		{ id: created.id },
		{ feedback: "well done" },
		opts(s),
	);
	expect(commented.rubric).toEqual(["k1"]);
	expect(commented.adjustment).toBe("0.2");
	expect(commented.score).toBe("0.7");
	expect(commented.feedback).toBe("well done");
	expect((await passesOf(answer))[0]?.rubricItems).toHaveLength(1);
});

test("update with rubric replaces the applied items", async () => {
	const { s, answer } = await standard();
	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["k1"] }),
		opts(s),
	);

	const updated = await db.feedback.update(
		{ id: created.id },
		{ rubric: ["k2", "r"] } as never,
		opts(s),
	);

	expect([...(updated.rubric ?? [])].sort()).toEqual(["k2", "r"]);
	expect(updated.score).toBe("0.75");
});

test("update with a score makes a rubric pass manual: no rubric, items or adjustment, and rubric changes no longer reach it", async () => {
	const { s, answer } = await standard();
	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["k1"], adjustment: "0.1" }),
		opts(s),
	);

	const manual = await db.feedback.update(
		{ id: created.id },
		{ score: "0.4" },
		opts(s),
	);

	expect(manual).toMatchObject({
		score: "0.4",
		rubric: null,
		adjustment: null,
		rubricItems: null,
	});
	const [row] = await passesOf(answer);
	expect(row?.rubricId).toBeNull();
	expect(row?.rubricItems).toEqual([]);
	expect(row?.adjustment).toBeNull();

	await db.rubric.update(s.main.pk, { base: "0.5" }, opts(s));
	expect(await storedScore(created.id)).toBe("0.4");
});

test("a pass with only a score behaves as before and reports no rubric", async () => {
	const { s, answer } = await standard();

	const created = await db.feedback.create(
		pass(answer, "m", { score: "0.3", feedback: "hm" }),
		opts(s),
	);
	const updated = await db.feedback.update(
		{ id: created.id },
		{ score: "0.6" },
		opts(s),
	);

	for (const result of [created, updated]) {
		expect(result.rubric).toBeNull();
		expect(result.adjustment).toBeNull();
		expect(result.review).toBe(false);
	}
	expect(updated.score).toBe("0.6");
	const [row] = await passesOf(answer);
	expect(row?.rubricId).toBeNull();
	expect(row?.rubricItems).toEqual([]);
});

test("upsert with rubric computes the score over an existing manual pass and over a new ref", async () => {
	const { s, answer } = await standard();
	const manual = await db.feedback.create(
		pass(answer, "same", { score: "0.1" }),
		opts(s),
	);

	const over = await db.feedback.upsert(
		pass(answer, "same", { rubric: ["k1"], adjustment: "0.1" }),
		opts(s),
	);
	const fresh = await db.feedback.upsert(
		pass(answer, "other", { rubric: ["k2"] }),
		opts(s),
	);

	expect(over.id).toBe(manual.id);
	expect(over.score).toBe("0.6");
	expect(over.rubric).toEqual(["k1"]);
	expect(fresh.score).toBe("0.25");
	expect(fresh.rubric).toEqual(["k2"]);
	expect(await storedScore(manual.id)).toBe("0.6");
});

test("upsert refuses score together with rubric", async () => {
	const { s, answer } = await standard();

	await expect(
		db.feedback.upsert(
			pass(answer, "x", { score: "0.5", rubric: ["k1"] }),
			opts(s),
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await passesOf(answer)).toEqual([]);
});

test("a bot pass with rubric gets its score computed and stays attributed to the bot", async () => {
	const { answer } = await standard();

	const created = await db.feedback.create(
		pass(answer, "bot", { bot: "runner", rubric: ["k1", "k2"] }),
		{ actor: SYSTEM },
	);

	expect(created.score).toBe("0.75");
	expect(created.bot).toBe("runner");
	expect(created.grader).toBeNull();
	expect(created.rubric).toHaveLength(2);
});

//
// R20: what the student sees
//

/// A released exam where one pass applies two of four items, each with a private comment and feedback.
async function releasedPass() {
	const s = await createRubricScenario();
	await s.seedRubric({
		items: [
			{
				key: "a",
				group: "Rec/Right",
				text: "Has base case",
				value: "0.5",
				comment: "PRIVATE-A",
				feedback: "Nice base case",
			},
			{
				key: "b",
				text: "Clear names",
				value: "0.25",
				comment: "PRIVATE-B",
				feedback: "Clear names",
			},
			{
				key: "c",
				text: "Unapplied C",
				value: "-0.25",
				comment: "PRIVATE-C",
				feedback: "FEEDBACK-C",
			},
			{
				key: "d",
				group: "Style",
				text: "Unapplied D",
				value: "-0.25",
				comment: "PRIVATE-D",
				feedback: "FEEDBACK-D",
			},
		],
	});
	const answer = await s.addAnswer();
	const created = await db.feedback.create(
		pass(answer, "r1", { rubric: ["a", "b"], feedback: "Overall fine" }),
		opts(s),
	);
	return { s, answer, created };
}

test("the graded student reads only the applied items, with group, text, value and feedback", async () => {
	const { s, answer, created } = await releasedPass();
	await s.release();

	const seen = await db.feedback.findOne(
		{ id: created.id },
		{ actor: answer.author },
	);
	const listed = await db.feedback.findMany(
		{ submission: { id: answer.submission.id }, course: s.course.id },
		{ actor: answer.author },
	);

	for (const view of [seen, listed[0]]) {
		expect(view?.score).toBe("0.75");
		expect(view?.feedback).toBe("Overall fine");
		expect(view?.rubricItems).toEqual([
			{
				group: "Rec/Right",
				text: "Has base case",
				value: "0.5",
				feedback: "Nice base case",
			},
			{
				group: null,
				text: "Clear names",
				value: "0.25",
				feedback: "Clear names",
			},
		]);
		const raw = JSON.stringify(view);
		for (const secret of [
			"PRIVATE-",
			"Unapplied",
			"FEEDBACK-C",
			"FEEDBACK-D",
		]) {
			expect(raw).not.toContain(secret);
		}
	}
});

test("the instructor reads the private comment of each applied item", async () => {
	const { s, created } = await releasedPass();
	await s.release();

	const seen = await db.feedback.findOne({ id: created.id }, opts(s));

	expect(seen?.rubricItems).toMatchObject([
		{ key: "a", comment: "PRIVATE-A", feedback: "Nice base case" },
		{ key: "b", comment: "PRIVATE-B", feedback: "Clear names" },
	]);
	expect(JSON.stringify(seen)).not.toContain("PRIVATE-C");
});

test("before the release the student reads nothing", async () => {
	const { s, answer, created } = await releasedPass();
	await s.close();

	const seen = await db.feedback.findOne(
		{ id: created.id },
		{ actor: answer.author },
	);
	const listed = await db.feedback.findMany(
		{ submission: { id: answer.submission.id }, course: s.course.id },
		{ actor: answer.author },
	);

	expect(seen).toBeNull();
	expect(listed).toEqual([]);
});
