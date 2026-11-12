/**
 * A retried item must not store its gap markers twice (spec
 * `dev/specs/to-do/historico-de-edicao-no-servidor.md`, R8 and R12).
 *
 * The client resends an item whenever it did not see the answer (R24, R25), so
 * the server meets the same item again.
 *
 * Each marker carries a client-generated id: a marker whose id is already
 * stored is skipped, a marker without an id is always stored.
 */
import { expect, test } from "@playwright/test";
import {
	appendBatch,
	makeWorld,
	send,
	storedField,
} from "./answer-edit-service-support";

test("a gap-only item sent twice stores one gap row", async () => {
	const world = await makeWorld();
	const item = {
		question: world.slugs.text,
		field: "answer",
		gaps: [{ reason: "storage lost", id: "gap-1" }],
	};

	const first = await send(world, [item]);
	const second = await send(world, [structuredClone(item)]);

	expect(first.results[0]).toMatchObject({ kind: "accepted" });
	expect(second.results[0]).toMatchObject({ kind: "accepted" });
	const stored = await storedField(world);
	expect(stored?.gaps.map((gap) => gap.reason)).toEqual(["storage lost"]);
});

test("a retried batch with gaps stores the batch and its gaps once", async () => {
	const world = await makeWorld();
	const item = {
		question: world.slugs.text,
		field: "answer",
		batch: appendBatch("", "hello"),
		gaps: [{ reason: "storage lost", id: "gap-1" }],
	};

	await send(world, [item]);
	const retried = await send(world, [structuredClone(item)]);

	expect(retried.results[0]).toMatchObject({ kind: "accepted" });
	const stored = await storedField(world);
	expect(stored?.batches).toHaveLength(1);
	expect(stored?.gaps.map((gap) => gap.reason)).toEqual(["storage lost"]);
});

test("two different markers sent one after the other are both stored", async () => {
	const world = await makeWorld();
	const field = { question: world.slugs.text, field: "answer" };

	await send(world, [{ ...field, gaps: [{ reason: "storage lost" }] }]);
	await send(world, [{ ...field, gaps: [{ reason: "exam switch off" }] }]);

	const stored = await storedField(world);
	expect(stored?.gaps.map((gap) => gap.reason)).toEqual([
		"storage lost",
		"exam switch off",
	]);
});

test("two distinct gaps with the same reason in separate calls stay two rows", async () => {
	const world = await makeWorld();
	const field = { question: world.slugs.text, field: "answer" };

	await send(world, [
		{ ...field, gaps: [{ reason: "storage lost", id: "gap-1" }] },
	]);
	await send(world, [
		{ ...field, gaps: [{ reason: "storage lost", id: "gap-2" }] },
	]);

	const stored = await storedField(world);
	expect(stored?.gaps.map((gap) => gap.reason)).toEqual([
		"storage lost",
		"storage lost",
	]);
});
