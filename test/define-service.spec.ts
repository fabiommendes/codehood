import { expect, test } from "@playwright/test";
import { z } from "zod";
import { SYSTEM } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import type { ServiceOptsWithoutTx as Opts } from "@/db/base-service";
import type { PrismaClient, PrismaTx } from "@/db/client";
import { defineService, inTx, op } from "@/db/define-service";

/// A client that records the transactions it opens and hands `tx` to the callback.
function fakeClient() {
	const tx = { marker: "opened-by-client" } as unknown as PrismaTx;
	const calls: PrismaTx[] = [];
	const client = {
		$transaction: (fn: (tx: PrismaTx) => Promise<unknown>) => {
			calls.push(tx);
			return fn(tx);
		},
	} as unknown as PrismaClient;
	return { client, tx, calls };
}

const callerTx = { marker: "from-caller" } as unknown as PrismaTx;
const actorOpts = { actor: SYSTEM as typeof SYSTEM };

test("inTx reuses opts.tx without opening a transaction", async () => {
	const { client, calls } = fakeClient();
	const seen = await inTx(
		client,
		{ ...actorOpts, tx: callerTx },
		async (tx) => tx,
	);
	expect(seen).toBe(callerTx);
	expect(calls).toHaveLength(0);
});

test("inTx opens a transaction when opts has no tx", async () => {
	const { client, tx, calls } = fakeClient();
	const seen = await inTx(client, actorOpts, async (t) => t);
	expect(seen).toBe(tx);
	expect(calls).toHaveLength(1);
});

test("inTx hands the callback options without tx", async () => {
	const { client } = fakeClient();
	const scoped = await inTx(
		client,
		{ ...actorOpts, tx: callerTx, validate: "input" },
		async (_tx, s) => s,
	);
	expect("tx" in scoped).toBe(false);
	expect(scoped.actor).toBe(SYSTEM);
	expect(scoped.validate).toBe("input");

	const viaClient = await inTx(client, actorOpts, async (_tx, s) => s);
	expect("tx" in viaClient).toBe(false);
});

const numberInput = z.object({ n: z.coerce.number().int() });
const numberOutput = z.object({ doubled: z.number() });

/// A service whose `create` doubles its input; `bad` decides whether the output is wrong.
const makeDoubler = defineService()((_client) => ({
	create: op({
		args: [numberInput],
		returns: numberOutput,
		run: async (_tx, input: { n: number }, _opts: Opts) => ({
			doubled: input.n * 2,
		}),
	}),
	broken: op({
		returns: numberOutput,
		run: async (_tx, _opts: Opts) => ({ doubled: "x" as unknown as number }),
	}),
	passthrough: op({
		args: [numberInput],
		run: async (_tx, input: { n: number }, _opts: Opts) => input,
	}),
}));

test("a service operation runs on the caller's tx and does not open one", async () => {
	const { client, calls } = fakeClient();
	const svc = makeDoubler(client);
	const out = await svc.create({ n: 2 }, { ...actorOpts, tx: callerTx });
	expect(out).toEqual({ doubled: 4 });
	expect(calls).toHaveLength(0);
});

test("a service operation opens a transaction without opts.tx", async () => {
	const { client, calls } = fakeClient();
	const svc = makeDoubler(client);
	await svc.create({ n: 2 }, actorOpts);
	expect(calls).toHaveLength(1);
});

test("an operation receives the tx and scoped options without tx", async () => {
	const { client, tx } = fakeClient();
	let received: { tx: unknown; opts: Record<string, unknown> } | undefined;
	const svc = defineService()(() => ({
		probe: op({
			run: async (t, opts: Opts) => {
				received = { tx: t, opts: opts as Record<string, unknown> };
			},
		}),
	}))(client);
	await svc.probe({ actor: SYSTEM, tx: callerTx });
	expect(received?.tx).toBe(callerTx);
	expect("tx" in (received?.opts ?? {})).toBe(false);

	await svc.probe(actorOpts);
	expect(received?.tx).toBe(tx);
});

/// A service with one `transaction: false` operation that reports what it ran on.
function makeReader(client: PrismaClient) {
	let received: { tx: unknown; opts: Record<string, unknown> } | undefined;
	const svc = defineService()(() => ({
		read: op({
			transaction: false,
			args: [numberInput],
			returns: numberOutput,
			run: async (t, input: { n: number }, opts: Opts) => {
				received = { tx: t, opts: opts as Record<string, unknown> };
				return { doubled: input.n * 2 };
			},
		}),
	}))(client);
	return { svc, received: () => received };
}

test("a transaction: false operation runs on the client without opening a transaction", async () => {
	const { client, calls } = fakeClient();
	const { svc, received } = makeReader(client);
	await expect(svc.read({ n: 3 }, actorOpts)).resolves.toEqual({ doubled: 6 });
	expect(calls).toHaveLength(0);
	expect(received()?.tx).toBe(client);
	expect("tx" in (received()?.opts ?? {})).toBe(false);
});

test("a transaction: false operation reuses the caller's tx", async () => {
	const { client, calls } = fakeClient();
	const { svc, received } = makeReader(client);
	await svc.read({ n: 3 }, { ...actorOpts, tx: callerTx });
	expect(calls).toHaveLength(0);
	expect(received()?.tx).toBe(callerTx);
});

test("a transaction: false operation still validates input and output", async () => {
	const { client } = fakeClient();
	const { svc } = makeReader(client);
	await expect(svc.read({ n: "x" } as never, actorOpts)).rejects.toThrow(
		InvalidData,
	);
	await expect(svc.read({ n: 1 }, {} as never)).rejects.toThrow(
		/not a ServiceOpts/,
	);
});

test("invalid input throws InvalidData before run", async () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	await expect(
		svc.create({ n: "abc" as unknown as number }, actorOpts),
	).rejects.toBeInstanceOf(InvalidData);
});

test("input schemas may convert the argument", async () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	const out = await svc.create({ n: "3" as unknown as number }, actorOpts);
	expect(out).toEqual({ doubled: 6 });
});

test("invalid output throws InvalidData", async () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	await expect(svc.broken(actorOpts)).rejects.toBeInstanceOf(InvalidData);
});

test("validate: none skips input and output validation", async () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	const out = await svc.passthrough(
		{ n: "abc" as unknown as number },
		{ ...actorOpts, validate: "none" },
	);
	expect(out).toEqual({ n: "abc" });
	await expect(svc.broken({ ...actorOpts, validate: "none" })).resolves.toEqual(
		{ doubled: "x" },
	);
});

test("validate: input skips only the output check", async () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	await expect(
		svc.create(
			{ n: "abc" as unknown as number },
			{
				...actorOpts,
				validate: "input",
			},
		),
	).rejects.toBeInstanceOf(InvalidData);
	await expect(
		svc.broken({ ...actorOpts, validate: "input" }),
	).resolves.toEqual({ doubled: "x" });
});

test("validate: output skips only the input check", async () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	await expect(
		svc.passthrough(
			{ n: "abc" as unknown as number },
			{
				...actorOpts,
				validate: "output",
			},
		),
	).resolves.toEqual({ n: "abc" });
	await expect(
		svc.broken({ ...actorOpts, validate: "output" }),
	).rejects.toBeInstanceOf(InvalidData);
});

test("operations may call each other with the shared tx", async () => {
	const { client, calls } = fakeClient();
	const svc = defineService()(() => {
		const double = op({
			run: async (_tx, n: number, _opts: Opts) => n * 2,
		});
		return {
			double,
			quadruple: op({
				run: async (tx, n: number, opts: Opts) =>
					double(tx, await double(tx, n, opts), opts),
			}),
		};
	})(client);
	expect(await svc.quadruple(3, actorOpts)).toBe(12);
	expect(calls).toHaveLength(1);
});

test("a missing operation does not exist on the service", () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	// @ts-expect-error `update` was not provided
	expect(svc.update).toBeUndefined();
	// @ts-expect-error `opts` is required on the public operation
	const neverCalled = () => svc.create({ n: 1 });
	expect(neverCalled).toBeInstanceOf(Function);
});

test("a CRUD shape rejects operations of the wrong type", () => {
	type T = {
		entity: { id: number };
		filter: unknown;
		pkFilter: { id: number };
		create: { name: string };
		update: { name?: string };
	};
	defineService<T>()(() => ({
		// @ts-expect-error create must return the entity
		create: op({
			run: async (_tx, _input: { name: string }, _opts: Opts) => "no",
		}),
	}));
	expect(true).toBe(true);
});

test("args are positional and an undefined schema skips its position", async () => {
	const { client } = fakeClient();
	const svc = defineService()(() => ({
		join: op({
			args: [z.string().min(3), undefined, z.coerce.number().positive()],
			run: async (_tx, a: string, b: number, c: number, _opts: Opts) =>
				`${a}:${b}:${c}`,
		}),
	}))(client);
	expect(await svc.join("abc", -1, "5" as unknown as number, actorOpts)).toBe(
		"abc:-1:5",
	);
	await expect(svc.join("ab", 1, 1, actorOpts)).rejects.toBeInstanceOf(
		InvalidData,
	);
	await expect(svc.join("abc", 1, -1, actorOpts)).rejects.toBeInstanceOf(
		InvalidData,
	);
});

test("validation errors are Error instances", async () => {
	const { client } = fakeClient();
	const svc = makeDoubler(client);
	await expect(svc.broken(actorOpts)).rejects.toBeInstanceOf(Error);
});

test("a non-ServiceOpts value in the opts position is rejected", async () => {
	const { client } = fakeClient();
	const svc = defineService()(() => ({
		echo: op({
			args: [z.string().min(1)],
			run: async (_tx, name: string, _opts: Opts) => name,
		}),
	}))(client);
	await expect(
		// @ts-expect-error - deliberately passing the wrong type, which JS allows
		svc.echo("abc", "not-opts"),
	).rejects.toThrow(/ServiceOpts/);
});
