/**
 * Conditional writes (ADR 0013): the one place that checks
 * `ServiceOpts.expectedUpdatedAt` and writes the row's next `updatedAt`.
 *
 * Every service whose model has `updatedAt` writes through {@link guardedUpdate}
 * and {@link guardedDelete}, and calls {@link touch} when it only changes child
 * rows that the parent's read model shows (tags, questions, repositories). The
 * helpers run on the `tx` of the write, address one row by a unique `where`,
 * and write the `updatedAt` themselves: there is nothing to forward. A service
 * whose model has no `updatedAt` calls {@link rejectExpectedUpdatedAt}.
 *
 * ```ts
 * // update
 * const row = await guardedUpdate(tx, "course", { id }, fields, opts, {
 *   include: courseInclude,
 * });
 *
 * // upsert: the row is absent, so there is nothing to guard
 * checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
 * await tx.course.create({ data });
 *
 * // delete, and child-only change
 * await guardedDelete(tx, "course", { id }, opts);
 * await touch(tx, "exam", { id }, opts);
 * ```
 */
import { InvalidData, PreconditionFailed } from "@/core/error";
import { m } from "@/i18n";
import type { Prisma, PrismaTx } from "./client";

/// Models whose rows have an `updatedAt` column.
export type VersionedModel = {
	[K in keyof PrismaTx & string]: PrismaTx[K] extends {
		fields: { updatedAt: unknown };
	}
		? K
		: never;
}[keyof PrismaTx & string];

/// The operations Prisma declares for the model behind a delegate name.
type Ops<M extends VersionedModel> =
	Capitalize<M> extends keyof Prisma.TypeMap["model"]
		? Prisma.TypeMap["model"][Capitalize<M>]["operations"]
		: never;

/// A `where` that addresses at most one row of `M`: its `WhereUniqueInput`.
export type UniqueWhere<M extends VersionedModel> =
	Ops<M>["findUnique"]["args"]["where"];

/// The `data` of an update of `M`, without `updatedAt`: the helper writes it.
export type GuardedData<M extends VersionedModel> = Omit<
	Ops<M>["update"]["args"]["data"],
	"updatedAt"
>;

/// What {@link guardedUpdate} adds to the update call, as in Prisma.
type Shape<M extends VersionedModel> = {
	include?: Ops<M>["update"]["args"] extends { include?: infer I } ? I : never;
	select?: Ops<M>["update"]["args"] extends { select?: infer S } ? S : never;
};

/// The `expectedUpdatedAt` of `ServiceOpts`.
type Expect = { expectedUpdatedAt?: Date | null };

/**
 * The `updatedAt` for a row that last had `previous`: the clock, or one
 * millisecond after `previous` when the clock has not moved past it.
 *
 * Strictly increasing per row, so two writes inside the same millisecond never
 * share a version and an older `If-Match` cannot match the newer row.
 */
export function nextUpdatedAt(previous: Date, now: Date = new Date()): Date {
	return new Date(Math.max(now.getTime(), previous.getTime() + 1));
}

/**
 * Throws {@link PreconditionFailed} unless `current` (the row's `updatedAt`, or
 * `null` when it does not exist) satisfies `expected`.
 *
 * Pure: use it directly where there is no row to write, e.g. the create branch
 * of an upsert, or a service that finds its row missing before calling a
 * guarded write: a `Date` on a missing row is a 412 with `null`, not a
 * `NotFound`.
 *
 * @throws {@link PreconditionFailed} Carrying `current`.
 */
export function checkExpectedUpdatedAt(
	current: Date | null,
	expected: Date | null | undefined,
): void {
	if (expected === undefined) return;
	if (expected === null) {
		if (current !== null) throw new PreconditionFailed(current);
		return;
	}
	if (current === null || current.getTime() !== expected.getTime()) {
		throw new PreconditionFailed(current);
	}
}

/**
 * Updates the row of `model` addressed by `where`, checking
 * `opts.expectedUpdatedAt` first and writing the next `updatedAt` with `data`.
 *
 * The check and the write run on `tx`, which SQLite serializes, so two writers
 * holding the same version cannot both pass. The versions are compared in
 * milliseconds, never as the text stored in the column. With a `Date`
 * expectation and no row, it throws {@link PreconditionFailed} with `null`;
 * with none, Prisma's own "record not found" error surfaces, so a service that
 * wants a `NotFound` looks the row up first. Do not forward `opts` to another
 * service for a different row: its `expectedUpdatedAt` belongs to this one.
 *
 * @param extra `include` or `select` for the returned row, and the clock
 * (`now`), which tests inject.
 * @throws {@link PreconditionFailed} When the row's version is not the expected one.
 */
export async function guardedUpdate<
	M extends VersionedModel,
	S extends Shape<M> = Record<never, never>,
>(
	tx: PrismaTx,
	model: M,
	where: UniqueWhere<M>,
	data: GuardedData<M>,
	opts: Expect,
	extra?: S & { now?: Date },
): Promise<
	Prisma.Result<
		PrismaTx[M],
		{ where: UniqueWhere<M>; data: GuardedData<M> } & S,
		"update"
	>
> {
	const delegate = untyped(tx, model);
	const updatedAt = await claim(delegate, where, opts, extra?.now);
	const { now: _now, ...shape } = extra ?? {};
	return delegate.update({
		where,
		data: { ...data, updatedAt },
		...shape,
	}) as never;
}

/**
 * Deletes the row of `model` addressed by `where`, checking
 * `opts.expectedUpdatedAt` first.
 *
 * A row that is already absent is a no-op unless a `Date` was expected.
 *
 * @throws {@link PreconditionFailed} When the row's version is not the expected one.
 */
export async function guardedDelete<M extends VersionedModel>(
	tx: PrismaTx,
	model: M,
	where: UniqueWhere<M>,
	opts: Expect,
): Promise<void> {
	const delegate = untyped(tx, model);
	const current = await readVersion(delegate, where);
	checkExpectedUpdatedAt(current, opts.expectedUpdatedAt);
	if (current === null) return;
	await delegate.delete({ where });
}

/**
 * Checks `opts.expectedUpdatedAt` against the row and moves its `updatedAt`
 * forward, for a write that only changed the row's children.
 *
 * Returns the new `updatedAt`.
 *
 * @throws {@link PreconditionFailed} When the row's version is not the expected one.
 */
export async function touch<M extends VersionedModel>(
	tx: PrismaTx,
	model: M,
	where: UniqueWhere<M>,
	opts: Expect,
	now?: Date,
): Promise<Date> {
	const delegate = untyped(tx, model);
	const updatedAt = await claim(delegate, where, opts, now);
	await delegate.update({ where, data: { updatedAt } });
	return updatedAt;
}

/**
 * Throws {@link PreconditionFailed} unless the row's current version satisfies
 * `opts.expectedUpdatedAt`, and writes nothing.
 *
 * For a service that must run other checks between the version check and its
 * guarded write (e.g. a 409 that a stale caller should not see).
 *
 * @throws {@link PreconditionFailed} When the row's version is not the expected one.
 */
export async function checkVersion<M extends VersionedModel>(
	tx: PrismaTx,
	model: M,
	where: UniqueWhere<M>,
	opts: Expect,
): Promise<void> {
	checkExpectedUpdatedAt(
		await readVersion(untyped(tx, model), where),
		opts.expectedUpdatedAt,
	);
}

/**
 * Refuses `opts.expectedUpdatedAt` in a service whose model has no `updatedAt`,
 * rather than ignoring a condition it cannot honor.
 *
 * @throws {@link InvalidData} When the option is set, even as `null`.
 */
export function rejectExpectedUpdatedAt(opts: Expect): void {
	if (opts.expectedUpdatedAt === undefined) return;
	throw new InvalidData({
		$: [{ code: "not-allowed", message: m.errors_precondition_unsupported() }],
	});
}

//
// Utilities
//

/// The slice of a Prisma delegate that the helpers use.
type VersionedDelegate = {
	findUnique(args: {
		where: unknown;
		select: { updatedAt: true };
	}): Promise<{ updatedAt: Date } | null>;
	update(args: Record<string, unknown>): Promise<unknown>;
	delete(args: { where: unknown }): Promise<unknown>;
};

const untyped = (tx: PrismaTx, model: VersionedModel): VersionedDelegate =>
	tx[model] as unknown as VersionedDelegate;

async function readVersion(
	delegate: VersionedDelegate,
	where: unknown,
): Promise<Date | null> {
	const row = await delegate.findUnique({ where, select: { updatedAt: true } });
	return row?.updatedAt ?? null;
}

/// Checks the expectation and returns the `updatedAt` to write: the clock when
/// there is no row, so the caller's write decides what a missing row means.
async function claim(
	delegate: VersionedDelegate,
	where: unknown,
	opts: Expect,
	now: Date = new Date(),
): Promise<Date> {
	const current = await readVersion(delegate, where);
	checkExpectedUpdatedAt(current, opts.expectedUpdatedAt);
	if (current === null) return now;
	return nextUpdatedAt(current, now);
}
