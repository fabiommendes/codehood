/**
 * Transaction-level helpers over the rubric tables, shared by the rubric and
 * feedback services.
 *
 * Nothing here checks permissions: the callers do, before reaching for these.
 */
import { InvalidData } from "@/core/error";
import type { FeedbackId, QuestionRefId } from "@/core/schemas";
import { m } from "@/i18n";
import { isNewerSubmission, newestPassesFirst } from "@/services/exam-result";
import {
	findGroupConflict,
	parseInitialRubric,
	rubricScore,
} from "@/services/rubric";
import type { PrismaTx } from "../client";
import { guardedUpdate } from "../conditional-write";

/// A rubric item as a stored row.
export interface StoredItem {
	id: number;
	key: string;
	group: string | null;
	text: string;
	value: string;
	comment: string | null;
	feedback: string | null;
	position: number;
	retiredAt: Date | null;
}

/// A stored rubric with its items by position.
export interface StoredRubric {
	id: number;
	base: string;
	sourceVersion: string | null;
	items: StoredItem[];
}

/// The question's initial rubric as read from its stored version.
export interface InitialRubric {
	items: Omit<StoredItem, "id" | "retiredAt">[];
	sourceVersion: string | null;
}

/// Finds the rubric stored for a question in an exam, or `null` when grading has not started.
export async function findStoredRubric(
	tx: PrismaTx,
	examId: number,
	questionRefId: number,
): Promise<StoredRubric | null> {
	return tx.rubric.findUnique({
		where: { examId_questionRefId: { examId, questionRefId } },
		select: {
			id: true,
			base: true,
			sourceVersion: true,
			items: { orderBy: { position: "asc" } },
		},
	});
}

/**
 * Reads the initial rubric of a question for an exam: the version the exam
 * pins, or the latest when it pins none.
 *
 * A malformed rubric is read as far as it goes, with each problem logged.
 */
export async function readInitialRubric(
	tx: PrismaTx,
	examId: number,
	questionRefId: number,
): Promise<InitialRubric> {
	const pinned = await tx.questionsForExam.findUnique({
		where: { examId_questionRefId: { examId, questionRefId } },
		select: { version: true },
	});
	const data = pinned?.version
		? await tx.questionData.findUnique({
				where: {
					refId_versionHash: {
						refId: questionRefId,
						versionHash: pinned.version,
					},
				},
			})
		: (
				await tx.questionRef.findUnique({
					where: { id: questionRefId as QuestionRefId },
					select: { latest: true },
				})
			)?.latest;

	const payload = (data?.privatePayload ?? {}) as Record<string, unknown>;
	const { items, warnings } = parseInitialRubric(payload.rubric);
	for (const warning of warnings) {
		console.warn(`question ${questionRefId}: ${warning}`);
	}
	return {
		items: items.map((item, position) => ({ ...item, position })),
		sourceVersion:
			payload.rubric === undefined ? null : (data?.versionHash ?? null),
	};
}

/**
 * The rubric of a question in an exam, copying the initial one into the
 * database when grading has not started.
 *
 * Every write that involves a rubric goes through here first.
 */
export async function materializeRubric(
	tx: PrismaTx,
	examId: number,
	questionRefId: number,
): Promise<StoredRubric> {
	const stored = await findStoredRubric(tx, examId, questionRefId);
	if (stored) return stored;

	const initial = await readInitialRubric(tx, examId, questionRefId);
	return tx.rubric.create({
		data: {
			examId,
			questionRefId,
			sourceVersion: initial.sourceVersion,
			items: { create: initial.items },
		},
		select: {
			id: true,
			base: true,
			sourceVersion: true,
			items: { orderBy: { position: "asc" } },
		},
	});
}

/// What a grading pass needs to be scored against a rubric.
export interface RubricPass {
	id: FeedbackId;
	score: string;
	adjustment: string | null;
	items: { id: number; key: string; value: string; retiredAt: Date | null }[];
}

/// Every pass graded with `rubricId`.
export async function loadRubricPasses(
	tx: PrismaTx,
	rubricId: number,
): Promise<RubricPass[]> {
	const rows = await tx.feedback.findMany({
		where: { rubricId },
		select: {
			id: true,
			score: true,
			adjustment: true,
			rubricItems: {
				select: {
					item: {
						select: { id: true, key: true, value: true, retiredAt: true },
					},
				},
			},
		},
	});
	return rows.map((row) => ({
		id: row.id,
		score: row.score,
		adjustment: row.adjustment,
		items: row.rubricItems.map((link) => link.item),
	}));
}

/// The score `pass` would have under `base`, with items overridden or removed by `change`.
export function scoreUnder(
	pass: RubricPass,
	base: string,
	change: { value?: Map<number, string>; removed?: number } = {},
): string {
	return rubricScore({
		base,
		adjustment: pass.adjustment,
		items: pass.items
			.filter((item) => item.id !== change.removed)
			.map((item) => ({
				...item,
				value: change.value?.get(item.id) ?? item.value,
			})),
	});
}

/// `score` in the form {@link rubricScore} writes, so two spellings of one number compare equal.
export function normalizeScore(score: string): string {
	return rubricScore({ base: score, items: [] });
}

/**
 * Recomputes the score of every pass graded with the rubric and writes the ones that moved.
 *
 * Passes the grader set by hand carry no `rubricId` and are never touched.
 * Returns the ids of the passes written, which moved their `updatedAt`.
 */
export async function recomputeRubricPasses(
	tx: PrismaTx,
	rubricId: number,
): Promise<Set<number>> {
	const rubric = await tx.rubric.findUniqueOrThrow({
		where: { id: rubricId },
		select: { base: true },
	});
	const written = new Set<number>();
	for (const pass of await loadRubricPasses(tx, rubricId)) {
		const next = scoreUnder(pass, rubric.base);
		if (next !== normalizeScore(pass.score)) {
			await guardedUpdate(tx, "feedback", { id: pass.id }, { score: next }, {});
			written.add(pass.id);
		}
	}
	return written;
}

/// How the counting answers of a question stand against its rubric.
export interface RubricStanding {
	/// Counting answers whose current grade applies the item, by item id.
	uses: Map<number, number>;
	/// Counting answers whose current grade applies a retired item.
	review: number;
}

/**
 * Counts, per item, the counting answers of a question whose current grade
 * applies it, and how many of them apply a retired item.
 *
 * Per attempt only the newest submission counts, and per submission only its
 * newest pass.
 */
export async function rubricStanding(
	tx: PrismaTx,
	examId: number,
	questionRefId: number,
): Promise<RubricStanding> {
	const submissions = await tx.submission.findMany({
		where: { questionId: questionRefId, response: { examId } },
		select: {
			id: true,
			createdAt: true,
			responseId: true,
			feedbacks: {
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				select: {
					updatedAt: true,
					rubricItems: {
						select: { itemId: true, item: { select: { retiredAt: true } } },
					},
				},
			},
		},
	});

	const counting = new Map<number, (typeof submissions)[number]>();
	for (const submission of submissions) {
		const current = counting.get(submission.responseId);
		if (!current || isNewerSubmission(submission, current)) {
			counting.set(submission.responseId, submission);
		}
	}

	const uses = new Map<number, number>();
	let review = 0;
	for (const submission of counting.values()) {
		const verdict = newestPassesFirst(submission.feedbacks)[0];
		if (!verdict) continue;
		for (const link of verdict.rubricItems) {
			uses.set(link.itemId, (uses.get(link.itemId) ?? 0) + 1);
		}
		if (verdict.rubricItems.some((link) => link.item.retiredAt !== null)) {
			review++;
		}
	}
	return { uses, review };
}

/// The grade a rubric gives a pass.
export interface RubricGrade {
	rubricId: number;
	score: string;
	adjustment: string | null;
	/// Ids of the items applied.
	itemIds: number[];
}

/**
 * Scores a pass that applies `keys` of the rubric of a question, copying the
 * initial rubric first when needed.
 *
 * A retired item is accepted only when `alreadyApplied` holds its id.
 *
 * @throws {@link InvalidData}
 * If a key is not in the rubric, a retired item is new to the pass, or two
 * items share a top-level group.
 */
export async function gradeWithRubric(
	tx: PrismaTx,
	target: { examId: number; questionRefId: number },
	pass: {
		keys: string[];
		adjustment: string | null;
		alreadyApplied: ReadonlySet<number>;
	},
): Promise<RubricGrade> {
	const rubric = await materializeRubric(
		tx,
		target.examId,
		target.questionRefId,
	);

	const chosen: StoredItem[] = [];
	for (const key of new Set(pass.keys)) {
		const item = rubric.items.find((candidate) => candidate.key === key);
		if (!item) {
			throw new InvalidData({
				rubric: [
					{ code: "not-exists", message: m.errors_rubric_key_unknown({ key }) },
				],
			});
		}
		if (item.retiredAt !== null && !pass.alreadyApplied.has(item.id)) {
			throw new InvalidData({
				rubric: [
					{ code: "invalid", message: m.errors_rubric_key_retired({ key }) },
				],
			});
		}
		chosen.push(item);
	}

	const conflict = findGroupConflict(chosen);
	if (conflict) {
		throw new InvalidData({
			rubric: [
				{
					code: "invalid",
					message: m.errors_rubric_group_conflict({
						group: conflict.group,
						keys: conflict.keys.join(", "),
					}),
				},
			],
		});
	}

	return {
		rubricId: rubric.id,
		score: rubricScore({
			base: rubric.base,
			items: chosen,
			adjustment: pass.adjustment,
		}),
		adjustment: pass.adjustment,
		itemIds: chosen.map((item) => item.id),
	};
}
