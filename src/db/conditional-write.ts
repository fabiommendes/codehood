/**
 * Conditional writes (ADR 0013): the one place that checks
 * `ServiceOpts.expectedUpdatedAt` and hands out the next `updatedAt`.
 *
 * Every service whose model has `updatedAt` goes through {@link guardRow} in
 * each `update`, `upsert` and `delete`, and also when it only changes child
 * rows that the parent's read model shows (tags, questions, repositories):
 * those touch the parent with the same call. A service whose model has no
 * `updatedAt` calls {@link rejectExpectedUpdatedAt} instead.
 *
 * ```ts
 * // update
 * const next = await guardRow(tx, { model: "course", where: { id } }, opts);
 * await tx.course.update({ where: { id }, data: { ...fields, updatedAt: next } });
 *
 * // upsert: the row is absent, so there is nothing to guard
 * checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
 * await tx.course.create({ data });
 *
 * // child-only change: touch the parent
 * await guardRow(tx, { model: "exam", where: { id } }, opts);
 * ```
 */
import {
	ImproperBehavior,
	InvalidData,
	PreconditionFailed,
} from "@/core/error";
import { m } from "@/i18n";
import type { PrismaClient, PrismaTx } from "./client";

/// Models whose rows have an `updatedAt` column.
export type VersionedModel = {
	[K in keyof PrismaTx & string]: PrismaTx[K] extends {
		fields: { updatedAt: unknown };
	}
		? K
		: never;
}[keyof PrismaTx & string];

/// The row a {@link guardRow} call addresses: a Prisma delegate name and a
/// `where` that matches at most one row (a unique key, in practice).
export type GuardTarget = {
	model: VersionedModel;
	where: Record<string, unknown>;
};

/// How many times {@link guardRow} rereads after another writer got in
/// between its read and its write.
const MAX_ATTEMPTS = 5;

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
 * of an upsert.
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
 * Checks `opts.expectedUpdatedAt` against the row and claims it, returning the
 * `updatedAt` the caller must write with the rest of its change.
 *
 * The claim is a compare-and-swap (`updateMany` filtered by the `updatedAt`
 * that was read), so two writers holding the same version cannot both pass.
 * Run it on the transaction of the write. Always pass the result as
 * `updatedAt` in the row's own update: left to Prisma's `@updatedAt`, the
 * value would be the bare clock and could repeat. Call it for every write the
 * service makes, conditional or not, and for a parent whose children changed
 * (the result is then ignored).
 *
 * With no row, it returns `now` without writing, so the caller's own write
 * decides what a missing row means (usually `NotFound`). Do not forward
 * `opts` to another service for a different row: its `expectedUpdatedAt`
 * belongs to this one.
 *
 * @param now The clock. Tests inject it.
 * @throws {@link PreconditionFailed} When the row's version is not the expected one.
 * @throws {@link ImproperBehavior} When the claim keeps losing to other writers.
 */
export async function guardRow(
	tx: PrismaTx | PrismaClient,
	target: GuardTarget,
	opts: { expectedUpdatedAt?: Date | null },
	now: Date = new Date(),
): Promise<Date> {
	const delegate = tx[target.model] as unknown as VersionedDelegate;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const row = await delegate.findFirst({
			where: target.where,
			select: { updatedAt: true },
		});
		checkExpectedUpdatedAt(row?.updatedAt ?? null, opts.expectedUpdatedAt);
		if (!row) return now;

		const next = nextUpdatedAt(row.updatedAt, now);
		const { count } = await delegate.updateMany({
			where: { ...target.where, updatedAt: row.updatedAt },
			data: { updatedAt: next },
		});
		if (count > 0) return next;
		// Someone wrote in between: reread. A conditional write now fails the
		// check above; an unconditional one claims the new version.
	}
	throw new ImproperBehavior(
		`${target.model}: could not claim the row after ${MAX_ATTEMPTS} attempts`,
	);
}

/**
 * Refuses `opts.expectedUpdatedAt` in a service whose model has no `updatedAt`,
 * rather than ignoring a condition it cannot honor.
 *
 * @throws {@link InvalidData} When the option is set, even as `null`.
 */
export function rejectExpectedUpdatedAt(opts: {
	expectedUpdatedAt?: Date | null;
}): void {
	if (opts.expectedUpdatedAt === undefined) return;
	throw new InvalidData({
		$: [{ code: "not-allowed", message: m.errors_precondition_unsupported() }],
	});
}

/// The slice of a Prisma delegate that {@link guardRow} uses.
type VersionedDelegate = {
	findFirst(args: {
		where: Record<string, unknown>;
		select: { updatedAt: true };
	}): Promise<{ updatedAt: Date } | null>;
	updateMany(args: {
		where: Record<string, unknown>;
		data: { updatedAt: Date };
	}): Promise<{ count: number }>;
};
