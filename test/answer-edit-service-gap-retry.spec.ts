/**
 * A retried item must not store its gap markers twice (spec
 * `dev/specs/to-do/historico-de-edicao-no-servidor.md`, R8 and R12).
 *
 * The client resends an item whenever it did not see the answer (R24, R25), so
 * the server meets the same item again.
 *
 * Reading used here, the spec gives gap markers no identity: a gap-only item
 * sent again unchanged is a retry and adds no second row. If the fix gives each
 * marker an id in the wire format, these tests must carry that id.
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
		gaps: [{ reason: "storage lost" }],
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
		gaps: [{ reason: "storage lost" }],
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
