import { expect, test } from "@playwright/test";
import { InvalidData, PreconditionFailed } from "@/core/error";
import { responseFromException } from "@/core/error-server";
import { type PrismaTx, prisma } from "@/db/client";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedDelete,
	guardedUpdate,
	nextUpdatedAt,
	rejectExpectedUpdatedAt,
	touch,
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
		touch(tx, "discipline", { slug }, { expectedUpdatedAt }, now),
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

test("touch with the right version moves updatedAt forward", async () => {
	const row = await makeRow();
	const next = await guard(row.slug, row.updatedAt);
	expect(next.getTime()).toBeGreaterThan(row.updatedAt.getTime());
	expect((await read(row.slug)).updatedAt).toEqual(next);
});

test("touch with a stale version throws and writes nothing", async () => {
	const row = await makeRow();
	const err = await guard(row.slug, new Date(0)).catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(row.updatedAt);
	expect((await read(row.slug)).updatedAt).toEqual(row.updatedAt);
});

test("touch without an expectation writes unconditionally", async () => {
	const row = await makeRow();
	const next = await guard(row.slug);
	expect(next.getTime()).toBeGreaterThan(row.updatedAt.getTime());
	expect((await read(row.slug)).updatedAt).toEqual(next);
});

test("touch with null on an existing row throws with its updatedAt", async () => {
	const row = await makeRow();
	const err = await guard(row.slug, null).catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect((err as PreconditionFailed).updatedAt).toEqual(row.updatedAt);
});

test("touch with a Date on a missing row throws with current null", async () => {
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
// guardedUpdate, guardedDelete
//

test("guardedUpdate writes the data and the next updatedAt in one call", async () => {
	const row = await makeRow();
	const updated = await prisma.$transaction((tx) =>
		guardedUpdate(
			tx,
			"discipline",
			{ slug: row.slug },
			{ name: "renamed" },
			{ expectedUpdatedAt: row.updatedAt },
		),
	);
	expect(updated.name).toBe("renamed");
	expect(updated.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
	expect(await read(row.slug)).toEqual(updated);
});

test("guardedUpdate with a stale version writes nothing", async () => {
	const row = await makeRow();
	const err = await prisma
		.$transaction((tx) =>
			guardedUpdate(
				tx,
				"discipline",
				{ slug: row.slug },
				{ name: "renamed" },
				{ expectedUpdatedAt: new Date(0) },
			),
		)
		.catch((e) => e);
	expect(err).toBeInstanceOf(PreconditionFailed);
	expect(await read(row.slug)).toEqual(row);
});

test("guardedDelete with the right version deletes, with a stale one does not", async () => {
	const row = await makeRow();
	const del = (expectedUpdatedAt?: Date | null) =>
		prisma.$transaction((tx) =>
			guardedDelete(
				tx,
				"discipline",
				{ slug: row.slug },
				{ expectedUpdatedAt },
			),
		);
	await expect(del(new Date(0))).rejects.toBeInstanceOf(PreconditionFailed);
	expect(await read(row.slug)).toEqual(row);
	await del(row.updatedAt);
	expect(
		await prisma.discipline.findUnique({ where: { slug: row.slug } }),
	).toBeNull();
});

test("checkVersion reads only", async () => {
	const row = await makeRow();
	const check = (expectedUpdatedAt?: Date | null) =>
		prisma.$transaction((tx) =>
			checkVersion(tx, "discipline", { slug: row.slug }, { expectedUpdatedAt }),
		);
	await check(row.updatedAt);
	await expect(check(new Date(0))).rejects.toBeInstanceOf(PreconditionFailed);
	expect(await read(row.slug)).toEqual(row);
});

//
// updatedAt stored in another format
//

/// Formats SQLite may hold in `updatedAt`: the migration's
/// `DEFAULT CURRENT_TIMESTAMP`, an offset suffix, and epoch milliseconds.
const STORED_FORMATS: [string, (at: Date) => string | number][] = [
	[
		"YYYY-MM-DD HH:MM:SS",
		(at) => at.toISOString().slice(0, 19).replace("T", " "),
	],
	["+00:00 suffix", (at) => `${at.toISOString().slice(0, 19)}+00:00`],
	["epoch milliseconds", (at) => at.getTime()],
];

async function makeRowStoredAs(value: string | number): Promise<string> {
	const row = await makeRow();
	await prisma.$executeRaw`UPDATE Discipline SET updatedAt = ${value} WHERE slug = ${row.slug}`;
	return row.slug;
}

for (const [label, format] of STORED_FORMATS) {
	const at = new Date("2026-11-12T18:09:20.000Z");

	test(`updatedAt stored as ${label}: unconditional update, conditional update and delete work`, async () => {
		const write = (
			slug: string,
			data: { name: string },
			expectedUpdatedAt?: Date,
		) =>
			prisma.$transaction((tx) =>
				guardedUpdate(tx, "discipline", { slug }, data, { expectedUpdatedAt }),
			);

		const slug = await makeRowStoredAs(format(at));
		const first = await write(slug, { name: "one" });
		expect(first.name).toBe("one");
		expect(first.updatedAt.getTime()).toBeGreaterThan(at.getTime());

		await prisma.$executeRaw`UPDATE Discipline SET updatedAt = ${format(at)} WHERE slug = ${slug}`;
		const readModel = await read(slug);
		expect(readModel.updatedAt.getTime()).toBe(at.getTime());
		const second = await write(slug, { name: "two" }, readModel.updatedAt);
		expect(second.name).toBe("two");

		await prisma.$executeRaw`UPDATE Discipline SET updatedAt = ${format(at)} WHERE slug = ${slug}`;
		const current = await read(slug);
		await prisma.$transaction((tx) =>
			guardedDelete(
				tx,
				"discipline",
				{ slug },
				{ expectedUpdatedAt: current.updatedAt },
			),
		);
		expect(await prisma.discipline.findUnique({ where: { slug } })).toBeNull();
	});
}

test("a Date on a missing row is a 412 with null, for update, delete and touch", async () => {
	const where = { slug: "cw-missing-row" };
	const opts = { expectedUpdatedAt: new Date() };
	const runs: ((tx: PrismaTx) => Promise<unknown>)[] = [
		(tx: PrismaTx) =>
			guardedUpdate(tx, "discipline", where, { name: "x" }, opts),
		(tx: PrismaTx) => guardedDelete(tx, "discipline", where, opts),
		(tx: PrismaTx) => touch(tx, "discipline", where, opts),
	];
	for (const run of runs) {
		const err = await prisma.$transaction(run).catch((e) => e);
		expect(err).toBeInstanceOf(PreconditionFailed);
		expect((err as PreconditionFailed).updatedAt).toBeNull();
	}
});
