import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, PreconditionFailed } from "@/core/error";
import { responseFromException } from "@/core/error-server";
import { type Crud, upsert } from "@/db/base-service";
import { prisma } from "@/db/client";
import {
	checkExpectedUpdatedAt,
	guardRow,
	nextUpdatedAt,
	rejectExpectedUpdatedAt,
} from "@/db/conditional-write";

let seq = 0;
async function makeRow(): Promise<{ slug: string; updatedAt: Date }> {
	seq += 1;
	const slug = `cw-helper-${seq}-${Math.random().toString(36).slice(2, 7)}`;
	return prisma.discipline.create({ data: { slug, name: slug } });
}

const read = (slug: string) =>
	prisma.discipline.findUniqueOrThrow({ where: { slug } });

const guard = (
	slug: string,
	expectedUpdatedAt?: Date | null,
	now?: Date,
): Promise<Date> =>
	prisma.$transaction((tx) =>
		guardRow(
			tx,
			{ model: "discipline", where: { slug } },
			{ expectedUpdatedAt },
			now,
		),
	);

test("nextUpdatedAt is the clock when it is ahead, else previous + 1ms", () => {
	const prev = new Date("2026-01-01T00:00:00.000Z");
	expect(nextUpdatedAt(prev, new Date("2026-01-01T00:00:05.000Z"))).toEqual(
		new Date("2026-01-01T00:00:05.000Z"),
	);
	expect(nextUpdatedAt(prev, prev)).toEqual(new Date(prev.getTime() + 1));
	expect(nextUpdatedAt(prev, new Date(prev.getTime() - 50))).toEqual(
		new Date(prev.getTime() + 1),
	);
});

test("checkExpectedUpdatedAt covers Date, null and absent", () => {
	const at = new Date("2026-01-01T00:00:00.000Z");
	expect(() => checkExpectedUpdatedAt(at, undefined)).not.toThrow();
	expect(() => checkExpectedUpdatedAt(null, undefined)).not.toThrow();
	expect(() => checkExpectedUpdatedAt(at, new Date(at))).not.toThrow();
	expect(() => checkExpectedUpdatedAt(null, null)).not.toThrow();
	expect(() => checkExpectedUpdatedAt(at, new Date(0))).toThrow(
		PreconditionFailed,
	);
	expect(() => checkExpectedUpdatedAt(at, null)).toThrow(PreconditionFailed);
	expect(() => checkExpectedUpdatedAt(null, at)).toThrow(PreconditionFailed);
});

test("PreconditionFailed serializes as a 412 with the current updatedAt", () => {
	const at = new Date("2026-03-04T05:06:07.008Z");
	const body = responseFromException(new PreconditionFailed(at), false);
	expect(body).toMatchObject({
		code: "precondition-failed",
		status: 412,
		updatedAt: "2026-03-04T05:06:07.008Z",
	});
	expect(
		responseFromException(new PreconditionFailed(null), false),
	).toMatchObject({ status: 412, updatedAt: null });
});

test("guardRow with the right version moves updatedAt forward", async () => {
	const row = await makeRow();
	const next = await guard(row.slug, row.updatedAt);
	expect(next.getTime()).toBeGreaterThan(row.updatedAt.getTime());
	expect((await read(row.slug)).updatedAt).toEqual(next);
});

test("guardRow with a stale version throws and writes nothing", async () => {
	const row = await makeRow();
	const err = await guard(row.slug, new Date(0)).catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(row.updatedAt);
	expect((await read(row.slug)).updatedAt).toEqual(row.updatedAt);
});

test("guardRow without an expectation writes unconditionally", async () => {
	const row = await makeRow();
	const next = await guard(row.slug);
	expect(next.getTime()).toBeGreaterThan(row.updatedAt.getTime());
	expect((await read(row.slug)).updatedAt).toEqual(next);
});

test("guardRow with null on an existing row throws with its updatedAt", async () => {
	const row = await makeRow();
	const err = await guard(row.slug, null).catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(row.updatedAt);
});

test("guardRow with a Date on a missing row throws with current null", async () => {
	const err = await guard("cw-missing-row", new Date()).catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toBeNull();
});

test("two writes in the same millisecond still get strictly increasing versions", async () => {
	const row = await makeRow();
	const frozen = new Date(row.updatedAt.getTime() + 10);
	const first = await guard(row.slug, undefined, frozen);
	const second = await guard(row.slug, undefined, frozen);
	expect(first).toEqual(frozen);
	expect(second.getTime()).toBe(first.getTime() + 1);
	// The version read before the second write is now stale.
	await expect(guard(row.slug, first, frozen)).rejects.toBeInstanceOf(
		PreconditionFailed,
	);
});

test("concurrent conditional writes with the same version: one wins", async () => {
	const row = await makeRow();
	const results = await Promise.allSettled([
		guard(row.slug, row.updatedAt),
		guard(row.slug, row.updatedAt),
		guard(row.slug, row.updatedAt),
	]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});

test("rejectExpectedUpdatedAt refuses any expectation, accepts none", () => {
	expect(() => rejectExpectedUpdatedAt({})).not.toThrow();
	expect(() =>
		rejectExpectedUpdatedAt({ expectedUpdatedAt: new Date() }),
	).toThrow(InvalidData);
	expect(() => rejectExpectedUpdatedAt({ expectedUpdatedAt: null })).toThrow(
		InvalidData,
	);
});

//
// Generic upsert
//

type Row = { key: string; updatedAt: Date };

/// A service double that records what `update` and `create` received.
function fakeService(existing: Row | null) {
	const calls: { op: string; expected: Date | null | undefined }[] = [];
	const service = {
		findOne: async () => existing,
		update: async (
			_pk: unknown,
			_in: unknown,
			opts: { expectedUpdatedAt?: Date | null },
		) => {
			calls.push({ op: "update", expected: opts.expectedUpdatedAt });
			if (opts.expectedUpdatedAt === null && existing) {
				throw new PreconditionFailed(existing.updatedAt);
			}
			return existing as Row;
		},
		create: async (_in: unknown, opts: { expectedUpdatedAt?: Date | null }) => {
			calls.push({ op: "create", expected: opts.expectedUpdatedAt });
			return { key: "new", updatedAt: new Date() };
		},
	};
	return { service: service as unknown as Crud<never>, calls };
}

function runUpsert(
	existing: Row | null,
	expectedUpdatedAt: Date | null | undefined,
) {
	const { service, calls } = fakeService(existing);
	const result = upsert(service as never, { key: "k" }, {
		...FULL_ACCESS,
		tx: {} as never,
		client: {} as never,
		expectedUpdatedAt,
		pk: (input: { key: string }) => input,
		action: "course.update",
	} as never);
	return { result, calls };
}

test("upsert: absent expectation updates or creates as before", async () => {
	const at = new Date(5);
	const a = runUpsert({ key: "k", updatedAt: at }, undefined);
	await a.result;
	expect(a.calls).toEqual([{ op: "update", expected: undefined }]);
	const b = runUpsert(null, undefined);
	await b.result;
	expect(b.calls).toEqual([{ op: "create", expected: undefined }]);
});

test("upsert: a Date goes to the update branch and fails on a missing row", async () => {
	const at = new Date(5);
	const a = runUpsert({ key: "k", updatedAt: at }, at);
	await a.result;
	expect(a.calls).toEqual([{ op: "update", expected: at }]);

	const b = runUpsert(null, at);
	const err = await b.result.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toBeNull();
	expect(b.calls).toEqual([]);
});

test("upsert: null creates when absent and fails when the row exists", async () => {
	const a = runUpsert(null, null);
	await a.result;
	expect(a.calls).toEqual([{ op: "create", expected: null }]);

	const at = new Date(5);
	const b = runUpsert({ key: "k", updatedAt: at }, null);
	const err = await b.result.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(at);
});
