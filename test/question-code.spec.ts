import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import type { CourseId, QuestionRefId } from "@/core/schemas";
import { codeQuestionMeta, questionCreate } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { assertResponse, publicForm, ResponseError } from "@/mdq";
import { codeFactory } from "@/mdq/factory";
import { sumCode } from "@/mdq/fixtures";
import { publicQuestionSchema } from "@/mdq/public-schema";

let seq = 0;
const uniq = () => `${++seq}-${Math.random().toString(36).slice(2, 7)}`;

async function makeCourse(): Promise<CourseId> {
	const edition = `${7000 + ++seq}-1`;
	await db.edition.create(
		{
			slug: edition,
			name: edition,
			startAt: new Date("2026-01-01"),
			endAt: new Date("2030-12-31"),
		},
		FULL_ACCESS,
	);
	const discipline = `qc-d-${uniq()}`;
	await db.discipline.create(
		{ slug: discipline, name: discipline },
		FULL_ACCESS,
	);
	const username = `qc-i-${uniq()}`;
	const instructor = await db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role: "INSTRUCTOR",
			password: "x",
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
	const course = await db.course.create(
		{
			discipline,
			instructor: instructor.username,
			edition,
			startAt: new Date("2026-02-02T00:00:00Z"),
			endAt: new Date("2026-06-01T00:00:00Z"),
		},
		FULL_ACCESS,
	);
	return course.id as CourseId;
}

type Doc = Parameters<typeof db.question.create>[0]["question"];

const withMeta = (meta?: Record<string, unknown>): Doc => ({
	...sumCode,
	...(meta ? { meta } : {}),
});

async function push(question: Doc, course?: CourseId) {
	return db.question.create(
		{
			course: course ?? (await makeCourse()),
			slug: `code-${uniq()}`,
			status: "PUBLISHED",
			version: "v1",
			rev: null,
			question,
		},
		FULL_ACCESS,
	);
}

const columns = (id: QuestionRefId) =>
	prisma.questionRef.findUniqueOrThrow({
		where: { id },
		select: { type: true, worker: true, attempts: true, penalty: true },
	});

test("a code question passes the question schema", () => {
	const result = questionCreate.safeParse({
		slug: "sum",
		status: "DRAFT",
		version: "1",
		rev: null,
		course: 1,
		question: sumCode,
	});
	expect(result.error?.issues ?? []).toEqual([]);
});

test("the public form of a code question has no key, hidden test or private rubric", () => {
	const form = publicQuestionSchema.parse(publicForm(sumCode));
	expect(form).toMatchObject({
		type: "code",
		language: "python",
		file: "sum.py",
		template: sumCode.template,
	});
	expect(form).toHaveProperty("publicTests");
	const json = JSON.stringify(form);
	for (const secret of [
		"answerKey",
		"return a + b",
		"test_secret_hidden_case",
		"Adds large numbers",
		"Readable code",
		"rubric",
		'"tests"',
	]) {
		expect(json, secret).not.toContain(secret);
	}
});

test("a pushed code question stores the whole document and the public form", async () => {
	const stored = await push(sumCode);
	const row = await columns(stored.id);
	expect(row.type).toBe("CODE");
	const data = await prisma.questionData.findFirstOrThrow({
		where: { refId: stored.id },
	});
	expect(data.privatePayload).toMatchObject({
		type: "code",
		answerKey: sumCode.answerKey,
		tests: sumCode.tests,
		rubric: sumCode.rubric,
	});
	expect(JSON.stringify(data.publicPayload)).not.toContain("answerKey");
	expect(JSON.stringify(data.publicPayload)).not.toContain("hidden_case");
	expect(data.publicPayload).toMatchObject({
		type: "code",
		language: "python",
	});
});

test("a code question with an unresolved test source is refused", async () => {
	const question: Doc = {
		...sumCode,
		tests: [{ format: "py", origin: "test_sum.py" }],
	};
	const err = await push(question).catch((e: unknown) => e);
	expect(err).toBeInstanceOf(InvalidData);
	expect((err as InvalidData).message).toMatch(/test_sum\.py/);
	expect((err as InvalidData).message).toMatch(/resolved/);
});

test("a manual rubric item worth more than 0 is refused", async () => {
	for (const value of [1, 2.5, -1, undefined]) {
		const question: Doc = {
			...sumCode,
			rubric: [
				{
					binding: "manual",
					text: "Style",
					...(value === undefined ? {} : { value }),
				},
			],
		};
		const err = await push(question).catch((e: unknown) => e);
		expect(err, String(value)).toBeInstanceOf(InvalidData);
		expect((err as InvalidData).message).toMatch(/manual/);
	}
});

test("without meta.worker the question is valid and has no worker", async () => {
	const stored = await push(sumCode);
	expect(await columns(stored.id)).toEqual({
		type: "CODE",
		worker: null,
		attempts: 4,
		penalty: "0.2",
	});
});

test("meta.worker, attempts and penalty go to the columns", async () => {
	const stored = await push(
		withMeta({ worker: "elm-test", attempts: 7, penalty: 0.5 }),
	);
	expect(await columns(stored.id)).toEqual({
		type: "CODE",
		worker: "elm-test",
		attempts: 7,
		penalty: "0.5",
	});
});

test("only worker given keeps the defaults for the policy", async () => {
	const stored = await push(withMeta({ worker: "pytest" }));
	expect(await columns(stored.id)).toMatchObject({
		worker: "pytest",
		attempts: 4,
		penalty: "0.2",
	});
});

test("a newer push without meta.worker clears the worker", async () => {
	const course = await makeCourse();
	const stored = await push(
		withMeta({ worker: "pytest", attempts: 2 }),
		course,
	);
	expect((await columns(stored.id)).worker).toBe("pytest");
	await db.question.update(
		{ id: stored.id },
		{ version: "v2", question: { ...sumCode, stem: "Changed." } },
		FULL_ACCESS,
	);
	expect(await columns(stored.id)).toEqual({
		type: "CODE",
		worker: null,
		attempts: 4,
		penalty: "0.2",
	});
});

test("a question of another type has null worker columns", async () => {
	const stored = await push({
		type: "essay",
		title: "E",
		stem: "Write.",
	});
	expect(await columns(stored.id)).toEqual({
		type: "ESSAY",
		worker: null,
		attempts: null,
		penalty: null,
	});
});

test("an invalid meta value refuses the push", async () => {
	const bad: Record<string, unknown>[] = [
		{ worker: "Elm Test" },
		{ worker: "" },
		{ worker: "a".repeat(41) },
		{ worker: 3 },
		{ attempts: 0 },
		{ attempts: 1.5 },
		{ attempts: "4" },
		{ penalty: -0.1 },
		{ penalty: 1.1 },
		{ penalty: "abc" },
	];
	for (const meta of bad) {
		const err = await push(withMeta(meta)).catch((e: unknown) => e);
		expect(err, JSON.stringify(meta)).toBeInstanceOf(InvalidData);
	}
});

test("codeQuestionMeta applies the defaults and keeps the bounds", () => {
	expect(codeQuestionMeta.parse(undefined)).toEqual({
		worker: null,
		attempts: 4,
		penalty: "0.2",
	});
	expect(codeQuestionMeta.parse({ other: "x" })).toEqual({
		worker: null,
		attempts: 4,
		penalty: "0.2",
	});
	expect(codeQuestionMeta.parse({ penalty: 0 }).penalty).toBe("0");
	expect(codeQuestionMeta.parse({ penalty: 1 }).penalty).toBe("1");
	expect(codeQuestionMeta.parse({ penalty: "0.25" }).penalty).toBe("0.25");
	expect(
		codeQuestionMeta.parse({ worker: "a".repeat(40) }).worker,
	).toHaveLength(40);
	expect(codeQuestionMeta.safeParse({ penalty: 2 }).success).toBe(false);
});

test("the factory builds a pushable code question", async () => {
	const stored = await push(codeFactory.build());
	expect((await columns(stored.id)).type).toBe("CODE");
});

test("the response to a code question is the content of the file", () => {
	expect(() => assertResponse(sumCode, "def add(a, b): ...")).not.toThrow();
	expect(() => assertResponse(sumCode, "")).not.toThrow();
	expect(() => assertResponse(sumCode, null)).not.toThrow();
	expect(() => assertResponse(sumCode, 42)).toThrow(ResponseError);
	expect(() => assertResponse(sumCode, { a: 1 })).toThrow(ResponseError);
});
