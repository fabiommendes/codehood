/**
 * Removing an attempt, or a user, logs what the edit history held
 * (`answer-history.removed`), measured in the transaction that removes it.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { courseHref } from "@/urls";
import {
	appendBatch,
	makeWorld,
	otherAttempt,
	sendBatch,
	type World,
} from "./answer-edit-service-support";

type Line = Record<string, unknown>;

/// Runs `fn` and returns the `answer-history.removed` lines it printed.
async function removedLines(fn: () => Promise<unknown>): Promise<Line[]> {
	const original = process.stdout.write;
	let out = "";
	process.stdout.write = ((chunk: string | Uint8Array) => {
		out += chunk.toString();
		return true;
	}) as typeof process.stdout.write;
	try {
		await fn();
	} finally {
		process.stdout.write = original;
	}
	return out
		.split("\n")
		.filter((l) => l.startsWith("{"))
		.map((l) => JSON.parse(l) as Line)
		.filter((l) => l.event === "answer-history.removed");
}

async function withHistory(world: World, text = "olá 😀") {
	await sendBatch(world, appendBatch("", text));
}

/// What the history of an attempt weighs, read before it is removed.
async function totals(responseIds: number[]) {
	const { measureAnswerHistory } = await import(
		"@/db/services/answer-edit.service"
	);
	return prisma.$transaction((tx) =>
		measureAnswerHistory(tx, { responseIds: responseIds as never }),
	);
}

test("removing an attempt with history logs what it held", async () => {
	const world = await makeWorld();
	await withHistory(world);
	const before = await totals([world.attempt.id]);
	expect(before.attempts).toBe(1);

	const lines = await removedLines(() =>
		db.response.delete({ publicId: world.attempt.publicId }, FULL_ACCESS),
	);

	expect(lines).toHaveLength(1);
	expect(lines[0]).toMatchObject({
		reason: "response-delete",
		course: courseHref({
			discipline: world.course.discipline.slug,
			instructor: world.course.instructor.username,
			edition: world.course.edition.slug,
		}).slice(1),
		exam: world.exam.slug,
		attempts: 1,
		fields: before.fields,
		batches: before.batches,
		edits: before.edits,
		countedBytes: before.countedBytes,
		storedBytes: before.storedBytes,
	});
	expect(JSON.stringify(lines[0])).not.toContain("olá");
	expect(
		await prisma.response.findUnique({ where: { id: world.attempt.id } }),
	).toBeNull();
});

test("removing an attempt without history logs nothing", async () => {
	const world = await makeWorld();
	const lines = await removedLines(() =>
		db.response.delete({ publicId: world.attempt.publicId }, FULL_ACCESS),
	);
	expect(lines).toEqual([]);
	expect(
		await prisma.response.findUnique({ where: { id: world.attempt.id } }),
	).toBeNull();
});

test("a failed measurement does not stop the removal and is logged as an error", async () => {
	const world = await makeWorld();
	await withHistory(world);

	const lines = await removedLines(() =>
		prisma.$transaction((tx) => {
			const broken = new Proxy(tx, {
				get(target, prop, receiver) {
					if (prop === "$queryRaw" || prop === "$queryRawUnsafe") {
						return () => Promise.reject(new Error("measurement broke"));
					}
					return Reflect.get(target, prop, receiver);
				},
			});
			return db.response.delete(
				{ publicId: world.attempt.publicId },
				{ ...FULL_ACCESS, tx: broken },
			);
		}),
	);

	expect(lines).toHaveLength(1);
	expect(lines[0]).toMatchObject({ reason: "response-delete" });
	expect(String(lines[0]?.error)).toContain("measurement broke");
	expect(
		await prisma.response.findUnique({ where: { id: world.attempt.id } }),
	).toBeNull();
});

test("a failed delete is not swallowed and logs nothing", async () => {
	const world = await makeWorld();
	await withHistory(world);
	const lines = await removedLines(async () => {
		await expect(
			db.response.delete({ publicId: "no-such-attempt" }, FULL_ACCESS),
		).rejects.toThrow();
	});
	expect(lines).toEqual([]);
	expect(
		await prisma.response.findUnique({ where: { id: world.attempt.id } }),
	).not.toBeNull();
});

test("removing a user without attempts logs nothing", async () => {
	const world = await makeWorld();
	const other = await otherAttempt(world);
	await prisma.response.delete({ where: { id: other.attempt.id } });

	const lines = await removedLines(() =>
		db.user.delete({ username: other.student.username }, FULL_ACCESS),
	);

	expect(lines).toEqual([]);
	expect(
		await prisma.user.findUnique({
			where: { username: other.student.username },
		}),
	).toBeNull();
});

test("a user with attempts is still refused, and nothing is logged or lost", async () => {
	const world = await makeWorld();
	await withHistory(world);

	const lines = await removedLines(async () => {
		await expect(
			db.user.delete({ username: world.student.username }, FULL_ACCESS),
		).rejects.toThrow();
	});

	expect(lines).toEqual([]);
	expect((await totals([world.attempt.id])).attempts).toBe(1);
});
