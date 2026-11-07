import { defineAction } from "astro:actions";
import { requireUser } from "@/auth/require-user";
import { NotFound } from "@/core/error";
import {
	gradingGroupRename,
	gradingItemAdd,
	gradingItemSplit,
	gradingRubricEdit,
} from "@/core/schemas";
import { db } from "@/db";
import { type PrismaTx, prisma } from "@/db/client";
import { examSchedule, released } from "@/services/exam-state";
import { parseCourseParams } from "@/urls";
import { toGraderItem } from "@/utils/grader-state";
import { loadCourseExceptions } from "@/utils/load-exam-exceptions";
import { withServiceErrors } from "./helpers";

/// Thrown inside a transaction to undo it after the scores it moved were counted.
class Undo extends Error {
	constructor(readonly passes: number) {
		super("undo");
	}
}

export const rubric = {
	/** Adds an item to a question's rubric (instructor only). */
	addItem: defineAction({
		input: gradingItemAdd,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { discipline: _d, course: _c, exam, question, ...item } = input;
			const created = await db.rubric.createItem(
				{
					course: parseCourseParams({
						discipline: input.discipline,
						course: input.course,
					}),
					exam,
					question,
				},
				item,
				{ actor },
			);
			return toGraderItem(created);
		}),
	}),

	/**
	 * Applies a set of rubric edits in one transaction, or only counts the scores they would move.
	 *
	 * With `dryRun` nothing is written; the answer is how many grades change and
	 * how many of those students already read.
	 */
	edit: defineAction({
		input: gradingRubricEdit,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const course = parseCourseParams({
				discipline: input.discipline,
				course: input.course,
			});
			const pk = { course, exam: input.exam, question: input.question };

			const write = async (tx: PrismaTx): Promise<void> => {
				if (input.base !== undefined) {
					await db.rubric.update(pk, { base: input.base }, { actor, tx });
				}
				for (const { key, ...patch } of input.items) {
					await db.rubric.updateItem({ ...pk, key }, patch, { actor, tx });
				}
				for (const key of input.deleted) {
					await db.rubric.deleteItem({ ...pk, key }, { actor, tx });
				}
			};
			if (!input.dryRun) {
				await prisma.$transaction(write);
				return { passes: 0, released: 0 };
			}

			const scores = async (tx?: PrismaTx) =>
				new Map(
					(await db.feedback.findMany({ ...pk }, { actor, tx })).map((pass) => [
						`${pass.submission}/${pass.ref}`,
						pass.score,
					]),
				);
			const before = await scores();
			let passes = 0;
			try {
				await prisma.$transaction(async (tx) => {
					await write(tx);
					let moved = 0;
					for (const [id, score] of await scores(tx)) {
						if (before.get(id) !== score) moved++;
					}
					throw new Undo(moved);
				});
			} catch (error) {
				if (!(error instanceof Undo)) throw error;
				passes = error.passes;
			}

			const exam = await db.exam.findOne(
				{ course, slug: input.exam },
				{ actor },
			);
			if (!exam) throw new NotFound("exam", { id: input.exam });
			const exceptions =
				(await loadCourseExceptions(course)).get(exam.slug) ?? new Map();
			const out = released(examSchedule(exam, exceptions), new Date());
			return { passes, released: out ? passes : 0 };
		}),
	}),

	/** Retires an item of a question's rubric and creates its children in its place (instructor only). */
	splitItem: defineAction({
		input: gradingItemSplit,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			const { key, children, exam, question } = input;
			const created = await db.rubric.splitItem(
				{
					course: parseCourseParams({
						discipline: input.discipline,
						course: input.course,
					}),
					exam,
					question,
					key,
				},
				{ children },
				{ actor },
			);
			return created.map(toGraderItem);
		}),
	}),

	/** Renames a group of a question's rubric and everything under it (instructor only). */
	renameGroup: defineAction({
		input: gradingGroupRename,
		handler: withServiceErrors(async (input, context) => {
			const actor = requireUser(context);
			return db.rubric.renameGroup(
				{
					course: parseCourseParams({
						discipline: input.discipline,
						course: input.course,
					}),
					exam: input.exam,
					question: input.question,
				},
				{ from: input.from, to: input.to },
				{ actor },
			);
		}),
	}),
};
