/**
 * The grading rubric of one question in one exam: a base score and a list of
 * items, each with a signed value, grouped by path.
 *
 * Grading starts the rubric: the first write that involves it copies the
 * question's initial rubric into the database. Changing the base, the value
 * of an item or deleting an applied item recomputes, in the same
 * transaction, the score of every pass graded with the rubric. Reads and
 * writes need `rubric.read` and `rubric.write` on the exam's course.
 */
import type { z } from "zod";
import { ensurePerm } from "@/auth/permissions";
import { InvalidData } from "@/core/error";
import {
	type CourseRef,
	rubricChange,
	rubricItemCreate,
	rubricItemPK,
	rubricItemPut,
	rubricItemSchema,
	rubricItemUpdate,
	rubricPK,
	rubricPreview,
	rubricRenameGroup,
	rubricRenameResult,
	rubricSchema,
	rubricSplit,
	rubricUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import { joinGroupPath, nextItemKey, parseGroupPath } from "@/services/rubric";
import type { Prisma, PrismaTx } from "../client";
import { courseRefWhere, valueOrNotFound } from "../utils";
import { examReleaseSelect, releasedToStudents } from "./feedback.service";
import {
	findStoredRubric,
	loadRubricPasses,
	materializeRubric,
	normalizeScore,
	readInitialRubric,
	recomputeRubricPasses,
	rubricStanding,
	type StoredItem,
	type StoredRubric,
	scoreUnder,
} from "./rubric-store";

//
// Type definitions
//
export type Rubric = z.infer<typeof rubricSchema>;
export type RubricItem = z.infer<typeof rubricItemSchema>;
export type RubricPK = z.infer<typeof rubricPK>;
export type RubricItemPK = z.infer<typeof rubricItemPK>;
export type RubricUpdate = z.infer<typeof rubricUpdate>;
export type RubricItemCreate = z.infer<typeof rubricItemCreate>;
export type RubricItemPut = z.infer<typeof rubricItemPut>;
export type RubricItemUpdate = z.infer<typeof rubricItemUpdate>;
export type RubricSplit = z.infer<typeof rubricSplit>;
export type RubricRenameGroup = z.infer<typeof rubricRenameGroup>;
export type RubricRenameResult = z.infer<typeof rubricRenameResult>;
export type RubricChange = z.infer<typeof rubricChange>;
export type RubricPreview = z.infer<typeof rubricPreview>;

/// The question and exam a rubric belongs to, resolved and authorized.
interface Target {
	examId: number;
	questionRefId: number;
	released: boolean;
}

/** The service of `client` (the shared client by default). */
export const makeRubricService = defineService()(() => {
	/**
	 * Finds the rubric of a question in an exam.
	 *
	 * When none is stored yet, answers with the question's initial rubric
	 * flagged `initial`, without writing it.
	 *
	 * @throws {@link NotFound} If the course or the exam does not exist, or the exam does not carry the question.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.read` on the course.
	 */
	const findOne = op({
		transaction: false,
		args: [rubricPK],
		returns: rubricSchema,
		run: async (
			tx: PrismaTx,
			pk: RubricPK,
			opts: ServiceOptsWithoutTx,
		): Promise<Rubric> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.read");
			const stored = await findStoredRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			if (stored) return view(tx, target, stored);

			const initial = await readInitialRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			return {
				base: "0",
				sourceVersion: initial.sourceVersion,
				initial: true,
				review: 0,
				items: initial.items.map((item) => ({
					...item,
					retiredAt: null,
					uses: 0,
				})),
			};
		},
	});

	/**
	 * Sets the base score of the rubric and recomputes every pass graded with it.
	 *
	 * @throws {@link NotFound} If the course, the exam or the question does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.write` on the course.
	 * @throws {@link InvalidData} If `base` is not a number in `[0, 1]`.
	 */
	const update = op({
		args: [rubricPK, rubricUpdate],
		returns: rubricSchema,
		run: async (
			tx: PrismaTx,
			pk: RubricPK,
			data: RubricUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<Rubric> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.write");
			const rubric = await materializeRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			await tx.rubric.update({
				where: { id: rubric.id },
				data: { base: data.base },
			});
			await recomputeRubricPasses(tx, rubric.id);
			return view(tx, target, await stored(tx, target));
		},
	});

	/**
	 * Adds an item to the rubric.
	 *
	 * Without a `key`, the item gets `i<n>`, one above the highest such key in
	 * the rubric, retired items included. The item goes last.
	 *
	 * @throws {@link NotFound} If the course, the exam or the question does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.write` on the course.
	 * @throws {@link InvalidData} If the key is in use, active or retired.
	 */
	const createItem = op({
		args: [rubricPK, rubricItemCreate],
		returns: rubricItemSchema,
		run: async (
			tx: PrismaTx,
			pk: RubricPK,
			input: RubricItemCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<RubricItem> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.write");
			const rubric = await materializeRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			const keys = rubric.items.map((item) => item.key);
			const key = input.key ?? nextItemKey(keys);
			ensureKeyFree(keys, key);

			const row = await tx.rubricItem.create({
				data: itemData(rubric.id, key, nextPosition(rubric.items), input),
			});
			return toItem(row, 0);
		},
	});

	/**
	 * Changes fields of an item, recomputing the passes that apply it when its value moves.
	 *
	 * @throws {@link NotFound} If the course, the exam, the question or the item does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.write` on the course.
	 * @throws {@link InvalidData} If a field is invalid.
	 */
	const updateItem = op({
		args: [rubricItemPK, rubricItemUpdate],
		returns: rubricItemSchema,
		run: async (
			tx: PrismaTx,
			pk: RubricItemPK,
			patch: RubricItemUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<RubricItem> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.write");
			const rubric = await materializeRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			const item = itemOrNotFound(rubric, pk.key);

			const row = await tx.rubricItem.update({
				where: { id: item.id },
				data: {
					...(patch.group !== undefined ? { group: patch.group } : {}),
					...(patch.text !== undefined ? { text: patch.text } : {}),
					...(patch.value !== undefined ? { value: patch.value } : {}),
					...(patch.comment !== undefined ? { comment: patch.comment } : {}),
					...(patch.feedback !== undefined ? { feedback: patch.feedback } : {}),
				},
			});
			if (patch.value !== undefined) await recomputeRubricPasses(tx, rubric.id);

			const standing = await rubricStanding(
				tx,
				target.examId,
				target.questionRefId,
			);
			return toItem(row, standing.uses.get(row.id) ?? 0);
		},
	});

	/**
	 * Creates the item under `pk.key`, or replaces its fields when it exists.
	 *
	 * Replacing clears the optional fields left out, and a changed value
	 * recomputes the passes as in `updateItem`.
	 *
	 * @throws {@link NotFound} If the course, the exam or the question does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.write` on the course.
	 * @throws {@link InvalidData} If a field is invalid.
	 */
	const upsertItem = op({
		args: [rubricItemPK, rubricItemPut],
		returns: rubricItemSchema,
		run: async (
			tx: PrismaTx,
			pk: RubricItemPK,
			input: RubricItemPut,
			opts: ServiceOptsWithoutTx,
		): Promise<RubricItem> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.write");
			const rubric = await materializeRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			const existing = rubric.items.find((item) => item.key === pk.key);
			if (!existing) {
				const row = await tx.rubricItem.create({
					data: itemData(rubric.id, pk.key, nextPosition(rubric.items), input),
				});
				return toItem(row, 0);
			}

			const row = await tx.rubricItem.update({
				where: { id: existing.id },
				data: {
					group: input.group ?? null,
					text: input.text,
					value: input.value,
					comment: input.comment ?? null,
					feedback: input.feedback ?? null,
				},
			});
			if (row.value !== existing.value)
				await recomputeRubricPasses(tx, rubric.id);

			const standing = await rubricStanding(
				tx,
				target.examId,
				target.questionRefId,
			);
			return toItem(row, standing.uses.get(row.id) ?? 0);
		},
	});

	/**
	 * Removes an item from the rubric and from every pass that applied it, then recomputes those passes.
	 *
	 * Deleting an item that is already gone resolves.
	 *
	 * @throws {@link NotFound} If the course, the exam or the question does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.write` on the course.
	 */
	const deleteItem = op({
		args: [rubricItemPK],
		run: async (
			tx: PrismaTx,
			pk: RubricItemPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.write");
			const rubric = await materializeRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			const item = rubric.items.find((candidate) => candidate.key === pk.key);
			if (!item) return;

			await tx.rubricItem.delete({ where: { id: item.id } });
			await recomputeRubricPasses(tx, rubric.id);
		},
	});

	/**
	 * Retires an item and creates its `children` in its place.
	 *
	 * The passes that applied the item keep their score and are flagged for
	 * review; a new pass cannot apply it. A child without a `group` goes under
	 * `<group>/<text>` of the retired item. The children follow it in order.
	 *
	 * @throws {@link NotFound} If the course, the exam, the question or the item does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.write` on the course.
	 * @throws {@link InvalidData} If a child's key is in use.
	 */
	const splitItem = op({
		args: [rubricItemPK, rubricSplit],
		returns: rubricItemSchema.array(),
		run: async (
			tx: PrismaTx,
			pk: RubricItemPK,
			input: RubricSplit,
			opts: ServiceOptsWithoutTx,
		): Promise<RubricItem[]> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.write");
			const rubric = await materializeRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			const parent = itemOrNotFound(rubric, pk.key);

			const keys = rubric.items.map((item) => item.key);
			const children = input.children.map((child) => {
				const key = child.key ?? nextItemKey(keys);
				ensureKeyFree(keys, key);
				keys.push(key);
				return { ...child, key };
			});

			await tx.rubricItem.updateMany({
				where: { rubricId: rubric.id, position: { gt: parent.position } },
				data: { position: { increment: children.length } },
			});
			if (parent.retiredAt === null) {
				await tx.rubricItem.update({
					where: { id: parent.id },
					data: { retiredAt: new Date() },
				});
			}

			const created: RubricItem[] = [];
			for (const [index, child] of children.entries()) {
				const row = await tx.rubricItem.create({
					data: itemData(rubric.id, child.key, parent.position + 1 + index, {
						...child,
						group: child.group ?? childGroup(parent),
					}),
				});
				created.push(toItem(row, 0));
			}
			return created;
		},
	});

	/**
	 * Replaces the prefix `from` by `to` in the group of every item of that group and its subgroups.
	 *
	 * A destination that differs from an existing group only by case or
	 * spaces is allowed, with a warning.
	 *
	 * @throws {@link NotFound} If the course, the exam or the question does not exist.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.write` on the course.
	 * @throws {@link InvalidData} If `from` or `to` is not a valid group path.
	 */
	const renameGroup = op({
		args: [rubricPK, rubricRenameGroup],
		returns: rubricRenameResult,
		run: async (
			tx: PrismaTx,
			pk: RubricPK,
			input: RubricRenameGroup,
			opts: ServiceOptsWithoutTx,
		): Promise<RubricRenameResult> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.write");
			const rubric = await materializeRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			const { from, to } = input;
			const inside = (group: string | null): group is string =>
				group !== null && (group === from || group.startsWith(`${from}/`));

			const moved = rubric.items.filter((item) => inside(item.group));
			for (const item of moved) {
				await tx.rubricItem.update({
					where: { id: item.id },
					data: { group: to + (item.group as string).slice(from.length) },
				});
			}

			const warnings = lookalikeGroups(
				rubric.items.filter((item) => !inside(item.group)),
				to,
			).map((existing) => m.errors_rubric_group_lookalike({ to, existing }));
			return { renamed: moved.length, warnings };
		},
	});

	/**
	 * Tells how many passes a change would move and how many of them students already read, writing nothing.
	 *
	 * A rubric not yet copied has no passes, so every change previews as none.
	 *
	 * @throws {@link NotFound} If the course, the exam or the question does not exist, or the change names an unknown item.
	 * @throws {@link NotAllowed} If `actor` lacks `rubric.read` on the course.
	 */
	const preview = op({
		transaction: false,
		args: [rubricPK, rubricChange],
		returns: rubricPreview,
		run: async (
			tx: PrismaTx,
			pk: RubricPK,
			change: RubricChange,
			opts: ServiceOptsWithoutTx,
		): Promise<RubricPreview> => {
			const target = await resolveTarget(tx, pk, opts, "rubric.read");
			const rubric = await findStoredRubric(
				tx,
				target.examId,
				target.questionRefId,
			);
			if (!rubric) return { passes: 0, released: 0 };

			let base = rubric.base;
			const overrides: { value?: Map<number, string>; removed?: number } = {};
			if (change.op === "update") {
				base = change.data.base;
			} else {
				const item = itemOrNotFound(rubric, change.key);
				if (change.op === "deleteItem") overrides.removed = item.id;
				else if (change.data.value !== undefined) {
					overrides.value = new Map([[item.id, change.data.value]]);
				}
			}

			const moved = (await loadRubricPasses(tx, rubric.id)).filter(
				(pass) =>
					scoreUnder(pass, base, overrides) !== normalizeScore(pass.score),
			);
			return {
				passes: moved.length,
				released: target.released ? moved.length : 0,
			};
		},
	});

	return {
		findOne,
		update,
		createItem,
		updateItem,
		upsertItem,
		deleteItem,
		splitItem,
		renameGroup,
		preview,
	};
});

/** The service, as built by {@link makeRubricService}. */
export type RubricService = ReturnType<typeof makeRubricService>;

// Private utilities -----------------------------------------------------------

/// Resolves the exam and question of `pk` and checks that `actor` holds `perm` on the course.
async function resolveTarget(
	tx: PrismaTx,
	pk: { course: CourseRef; exam: string; question: string },
	opts: ServiceOptsWithoutTx,
	perm: "rubric.read" | "rubric.write",
): Promise<Target> {
	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(pk.course),
			select: { id: true, instructor: { select: { username: true } } },
		}),
	);
	ensurePerm(opts.actor, perm, course);

	const exam = valueOrNotFound(
		"exam",
		await tx.exam.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: pk.exam } },
			select: { id: true, ...examReleaseSelect() },
		}),
	);
	const carried = valueOrNotFound(
		"question",
		await tx.questionsForExam.findFirst({
			where: {
				examId: exam.id,
				questionRef: { courseId: course.id, slug: pk.question },
			},
			select: { questionRefId: true },
		}),
	);
	return {
		examId: exam.id,
		questionRefId: carried.questionRefId,
		released: releasedToStudents(exam, new Date()),
	};
}

/// The rubric just written, read back.
async function stored(tx: PrismaTx, target: Target): Promise<StoredRubric> {
	return valueOrNotFound(
		"rubric",
		await findStoredRubric(tx, target.examId, target.questionRefId),
	);
}

/// The public view of a stored rubric, with item uses and the review count.
async function view(
	tx: PrismaTx,
	target: Target,
	rubric: StoredRubric,
): Promise<Rubric> {
	const standing = await rubricStanding(
		tx,
		target.examId,
		target.questionRefId,
	);
	return {
		base: rubric.base,
		sourceVersion: rubric.sourceVersion,
		initial: false,
		review: standing.review,
		items: rubric.items.map((item) =>
			toItem(item, standing.uses.get(item.id) ?? 0),
		),
	};
}

/// The public form of a stored item.
function toItem(row: StoredItem, uses: number): RubricItem {
	return {
		key: row.key,
		group: row.group,
		text: row.text,
		value: row.value,
		comment: row.comment,
		feedback: row.feedback,
		position: row.position,
		retiredAt: row.retiredAt,
		uses,
	};
}

/// The item of `rubric` under `key`.
function itemOrNotFound(rubric: StoredRubric, key: string): StoredItem {
	return valueOrNotFound(
		"rubric item",
		rubric.items.find((item) => item.key === key),
		{ id: key },
	);
}

/// Refuses a key already used by an item of the rubric, retired or not.
function ensureKeyFree(keys: string[], key: string): void {
	if (keys.includes(key)) {
		throw new InvalidData({
			key: [{ code: "invalid", message: m.errors_rubric_key_exists({ key }) }],
		});
	}
}

/// The position after the last item.
function nextPosition(items: StoredItem[]): number {
	return items.reduce((last, item) => Math.max(last, item.position + 1), 0);
}

/// The row data for a new item.
function itemData(
	rubricId: number,
	key: string,
	position: number,
	input: RubricItemCreate,
): Prisma.RubricItemUncheckedCreateInput {
	return {
		rubricId,
		key,
		position,
		group: input.group ?? null,
		text: input.text,
		value: input.value,
		comment: input.comment ?? null,
		feedback: input.feedback ?? null,
	};
}

/// The group the children of a split item go to by default: `<group>/<text>` of the item.
function childGroup(parent: StoredItem): string {
	const text = parent.text.replace(/[/:]/g, "-").trim() || parent.key;
	const own = parent.group === null ? [] : (parseGroupPath(parent.group) ?? []);
	return joinGroupPath([...own, text]);
}

/// The groups of `items`, ancestors included, that differ from `name` only by case or spaces.
function lookalikeGroups(items: StoredItem[], name: string): string[] {
	const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();
	const groups = new Set<string>();
	for (const item of items) {
		if (item.group === null) continue;
		const segments = item.group.split("/");
		for (let end = 1; end <= segments.length; end++) {
			groups.add(segments.slice(0, end).join("/"));
		}
	}
	return [...groups].filter(
		(group) => group !== name && squash(group) === squash(name),
	);
}
