/**
 * The database models of the answer-edit history (spec
 * `dev/specs/to-do/historico-de-edicao-no-servidor.md`, R1 to R3).
 *
 * Rows are arranged through `prisma`: the service that writes them comes
 * later.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";

/// A graded attempt plus one question of its course, ready to carry history.
async function attemptWithQuestion() {
	const response = await persistedResponseFactory.create();
	const question = await persistedQuestionFactory.create({
		course: response.courseId,
	});
	return { response, question };
}

async function seedHistory(
	responseId: schema.ResponseId,
	questionId: schema.QuestionRefId,
) {
	const history = await prisma.answerEditHistory.create({
		data: { responseId },
	});
	const field = await prisma.answerEditField.create({
		data: { historyId: history.id, questionId, field: "answer", text: "ab" },
	});
	await prisma.answerEditBatch.create({
		data: {
			fieldId: field.id,
			batchId: "b1",
			revision: 1,
			firstSeq: 0,
			editCount: 2,
			sessionId: "s1",
			timeOriginMs: 0,
			version: 1,
			edits: [],
			contentHash: "h",
			byteCount: 10,
		},
	});
	await prisma.answerEditGap.create({
		data: { fieldId: field.id, reason: "disabled" },
	});
	return { history, field };
}

function counts() {
	return Promise.all([
		prisma.answerEditHistory.count(),
		prisma.answerEditField.count(),
		prisma.answerEditBatch.count(),
		prisma.answerEditGap.count(),
	]);
}

test("deleting the attempt through the service deletes its whole history", async () => {
	const { response, question } = await attemptWithQuestion();
	const other = await attemptWithQuestion();
	await seedHistory(response.id, question.id);
	await seedHistory(other.response.id, other.question.id);
	const before = await counts();

	await db.response.delete({ id: response.id }, FULL_ACCESS);

	const after = await counts();
	// One history, one field, one batch and one gap went; the other attempt's stayed.
	expect(after.map((n, i) => (before[i] ?? 0) - n)).toEqual([1, 1, 1, 1]);
	expect(
		await prisma.answerEditHistory.count({
			where: { responseId: other.response.id },
		}),
	).toBe(1);
});

test("an attempt has one history, a history one field per question and name", async () => {
	const { response, question } = await attemptWithQuestion();
	const { history } = await seedHistory(response.id, question.id);

	await expect(
		prisma.answerEditHistory.create({ data: { responseId: response.id } }),
	).rejects.toThrow(/Unique constraint/);
	await expect(
		prisma.answerEditField.create({
			data: {
				historyId: history.id,
				questionId: question.id,
				field: "answer",
				text: "",
			},
		}),
	).rejects.toThrow(/Unique constraint/);
	// Another field name of the same question is fine.
	await prisma.answerEditField.create({
		data: {
			historyId: history.id,
			questionId: question.id,
			field: "notes",
			text: "",
		},
	});
});

test("a field takes one batch per revision and one per batch id", async () => {
	const { response, question } = await attemptWithQuestion();
	const { field } = await seedHistory(response.id, question.id);
	const batch = (batchId: string, revision: number) =>
		prisma.answerEditBatch.create({
			data: {
				fieldId: field.id,
				batchId,
				revision,
				firstSeq: 0,
				editCount: 1,
				sessionId: "s1",
				timeOriginMs: 0,
				version: 1,
				edits: [],
				contentHash: "h",
				byteCount: 1,
			},
		});

	await expect(batch("b2", 1)).rejects.toThrow(/Unique constraint/);
	await expect(batch("b1", 2)).rejects.toThrow(/Unique constraint/);
	await batch("b2", 2);
});

test("a new anchor starts empty and the stored defaults are zero", async () => {
	const { response, question } = await attemptWithQuestion();
	const history = await prisma.answerEditHistory.create({
		data: { responseId: response.id },
	});
	const field = await prisma.answerEditField.create({
		data: {
			historyId: history.id,
			questionId: question.id,
			field: "answer",
			text: "",
		},
	});

	expect(history).toMatchObject({
		editCount: 0,
		byteCount: 0,
		incompleteAt: null,
	});
	expect(field).toMatchObject({ revision: 0, nextSeq: 0, incompleteAt: null });
});

test("no history model refers to Submission", () => {
	const schema = readFileSync("prisma/schema.prisma", "utf-8");
	const models = [
		...schema.matchAll(/^model (AnswerEdit\w+) \{([\s\S]*?)^\}/gm),
	];

	expect(models.map((m) => m[1]).sort()).toEqual([
		"AnswerEditBatch",
		"AnswerEditField",
		"AnswerEditGap",
		"AnswerEditHistory",
	]);
	for (const [, name, body] of models) {
		expect(body, name).not.toMatch(/Submission/i);
	}
});

test("ten ordinary batches keep full text only in the anchor and the base", async () => {
	const { response, question } = await attemptWithQuestion();
	const history = await prisma.answerEditHistory.create({
		data: { responseId: response.id },
	});
	const field = await prisma.answerEditField.create({
		data: {
			historyId: history.id,
			questionId: question.id,
			field: "answer",
			text: "",
		},
	});
	for (let i = 1; i <= 10; i++) {
		await prisma.answerEditBatch.create({
			data: {
				fieldId: field.id,
				batchId: `b${i}`,
				revision: i,
				firstSeq: i - 1,
				editCount: 1,
				sessionId: "s",
				timeOriginMs: 0,
				version: 1,
				edits: [[0, 0, 0, "x", 0]],
				contentHash: `h${i}`,
				byteCount: 12,
				// Only the first batch of a field carries the text it starts from.
				...(i === 1 && { baseReason: "start", baseText: "" }),
			},
		});
	}

	const rows = await prisma.answerEditBatch.findMany({
		where: { fieldId: field.id },
	});
	expect(rows.filter((r) => r.baseText !== null)).toHaveLength(1);
	expect(rows.filter((r) => r.gapBefore !== null)).toHaveLength(0);
});

test("the exam switch is nullable and starts null", async () => {
	const exam = await persistedExamFactory.create();
	const row = await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } });

	expect(row.answerHistory).toBeNull();
});
