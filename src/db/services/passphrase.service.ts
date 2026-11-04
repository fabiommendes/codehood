import { customAlphabet } from "nanoid";
import type { z } from "zod";
import { SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { NotAllowed, NotFound } from "@/core/error";
import {
	type CourseId,
	type CourseRef,
	type PassphraseId,
	passphraseCreate,
	passphraseFilter,
	passphrasePK,
	passphraseSchema,
	passphraseUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import type { FillUndefineds } from "@/typing";
import type { Passphrase as DbPassphrase, Prisma, PrismaTx } from "../client";
import { courseRefWhere } from "../utils";

export type { PassphraseId } from "@/core/schemas";

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes; the join form shows only while one is live.

// Uppercase letters and digits only, minus the pairs a student squinting at a
// slide is likely to confuse (0/O, 1/I/L) — this is read aloud and typed once,
// not remembered, so "simple" means "survives a projector" more than "short".
const generateValue = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

//
// Type definitions
//
export type PassphraseCreate = z.infer<typeof passphraseCreate>;
export type Passphrase = z.infer<typeof passphraseSchema>;
export type PassphraseFilter = z.infer<typeof passphraseFilter>;
export type PassphrasePK = z.infer<typeof passphrasePK>;
export type PassphraseUpdate = z.infer<typeof passphraseUpdate>;

/// Why a passphrase could not be redeemed.
export type PassphraseErrorCode = "unknown" | "expired" | "own_course";

/// The CRUD shape of the passphrase service. `upsert` is off: `value` is
/// server-generated and the only updatable field is `expiresAt`.
type PassphraseT = {
	entity: Passphrase;
	pkFilter: PassphrasePK;
	create: PassphraseCreate;
	filter: PassphraseFilter;
	update: PassphraseUpdate;
	upsert: false;
};

/** Refusal from `redeem`, carrying a machine-readable `code`. */
export class PassphraseError extends Error {
	constructor(public code: PassphraseErrorCode) {
		super(code);
	}
}

/** The course a redeemed passphrase enrolled its redeemer in. */
export interface PassphraseRedemption {
	discipline: string;
	instructor: string;
	edition: string;
	/// The discipline's display name.
	name: string;
}

/**
 * A short-lived, course-scoped join code.
 *
 * The in-class counterpart to a classroom invite link.
 *
 * There is no management UI for these: an instructor generates one from
 * the Students tab, reads it out, and it expires on its own five minutes later.
 * `findOne({ value })` is deliberately not actor-filtered, the same
 * reasoning as `InviteService.findOne` by token — the value itself is the
 * credential a joining student presents, not something they're granted read
 * access to separately.
 */
export const makePassphraseService = defineService<PassphraseT>()(() => {
	/**
	 * Creates a passphrase for `input.courseId`, course-owner (or system)
	 * only.
	 *
	 * The passphrase `value` defaults to an auto-generated code, retried on
	 * the rare collision against the system-wide unique constraint; an instructor's
	 * own override that collides is refused with a message naming the
	 * conflict, rather than silently regenerated out from under them.
	 */
	const create = op({
		args: [passphraseCreate],
		returns: passphraseSchema,
		run: async (
			tx: PrismaTx,
			input: PassphraseCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<Passphrase> => {
			const course = await requireManageableCourse(
				tx,
				input.course,
				opts,
				"create",
			);
			const expiresAt = new Date(Date.now() + EXPIRY_MS);

			if (input.value) {
				if (await tx.passphrase.findUnique({ where: { value: input.value } })) {
					throw new Error(m.errors_passphrase_in_use({ value: input.value }));
				}
				return toPassphrase(
					await tx.passphrase.create({
						data: { courseId: course.id, value: input.value, expiresAt },
					}),
				);
			}

			for (let attempt = 0; attempt < 5; attempt++) {
				const value = generateValue();
				if (await tx.passphrase.findUnique({ where: { value } })) continue;
				return toPassphrase(
					await tx.passphrase.create({
						data: { courseId: course.id, value, expiresAt },
					}),
				);
			}
			throw new Error(m.errors_passphrase_generate_failed());
		},
	});

	/**
	 * Finds a single passphrase by id or by its value.
	 *
	 * Not actor-filtered on the `value` path — see the service doc. The `id`
	 * path is used internally by `update`/`delete` and isn't reachable from
	 * outside this file today, but stays consistent with every other
	 * service's `findOne`.
	 */
	const findOne = op({
		transaction: false,
		args: [passphrasePK],
		returns: passphraseSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: PassphrasePK,
			_opts: ServiceOptsWithoutTx,
		): Promise<Passphrase | null> => {
			const by = filter as FillUndefineds<PassphrasePK>; // zod doesn't narrow to a single field, so we do it here

			let row: DbPassphrase | null = null;
			if (by.id !== undefined) {
				row = await tx.passphrase.findUnique({
					where: { id: by.id as PassphraseId },
				});
			} else if (by.value !== undefined) {
				row = await tx.passphrase.findUnique({
					where: { value: by.value },
				});
			}
			return row && toPassphrase(row);
		},
	});

	/**
	 * Lists a course's passphrases, course-owner (or system) only.
	 *
	 * With no `courseId`, only a trusted internal caller (`SYSTEM`) may list
	 * across every course at once. No caller yet — there is no management
	 * UI.
	 */
	const findMany = op({
		transaction: false,
		args: [passphraseFilter],
		returns: passphraseSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: PassphraseFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<Passphrase[]> => {
			let course: { id: CourseId } | undefined;
			if (filter.course !== undefined) {
				course = await requireManageableCourse(tx, filter.course, opts, "read");
			} else if (opts.actor !== SYSTEM) {
				throw new NotAllowed("passphrase.read");
			}
			const rows = await tx.passphrase.findMany({
				where: {
					AND: [
						course ? { courseId: course.id } : {},
						filter.active ? { expiresAt: { gt: new Date() } } : {},
					],
				},
				orderBy: { createdAt: "desc" },
			});
			return rows.map(toPassphrase);
		},
	});

	/**
	 * Extends (or shortens) how long a passphrase stays live. Course-owner
	 * (or system) only.
	 */
	const update = op({
		args: [passphrasePK, passphraseUpdate],
		returns: passphraseSchema,
		run: async (
			tx: PrismaTx,
			filter: PassphrasePK,
			fields: PassphraseUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<Passphrase> => {
			const target = await findOne(tx, filter, opts);
			if (!target) throw new Error("passphrase not found");
			await requireManageableCourse(tx, target.courseId, opts, "update");
			return toPassphrase(
				await tx.passphrase.update({
					where: { id: target.id },
					data: { expiresAt: fields.expiresAt },
				}),
			);
		},
	});

	/**
	 * Enrolls the actor in the course a live passphrase belongs to.
	 *
	 * Surrounding whitespace is ignored, and a value that does not match as
	 * typed is retried in upper case. Enrolling an already active student is a
	 * no-op, and a `DROPPED` enrollment is reactivated. Any signed-in user may
	 * redeem, except the course's own instructor.
	 *
	 * @throws PassphraseError `unknown` when no passphrase has this value,
	 *   `expired` when it is past `expiresAt`, `own_course` when the actor
	 *   teaches the course.
	 */
	const redeem = op({
		run: async (
			tx: PrismaTx,
			value: string,
			opts: ServiceOptsWithoutTx,
		): Promise<PassphraseRedemption> => {
			if (opts.actor === SYSTEM) throw new NotAllowed("enrollment.create");
			const username = opts.actor.username;
			const typed = value.trim();

			const select = {
				id: true,
				expiresAt: true,
				course: {
					select: {
						id: true,
						disciplineSlug: true,
						instructorId: true,
						editionSlug: true,
						discipline: { select: { name: true } },
					},
				},
			} satisfies Prisma.PassphraseSelect;
			const row =
				(await tx.passphrase.findUnique({ where: { value: typed }, select })) ??
				(await tx.passphrase.findUnique({
					where: { value: typed.toUpperCase() },
					select,
				}));
			if (!row) throw new PassphraseError("unknown");
			if (row.expiresAt <= new Date()) throw new PassphraseError("expired");

			const { course } = row;
			if (course.instructorId === username)
				throw new PassphraseError("own_course");

			// Enrolls as a trusted internal step: the redeemer has no
			// `enrollment.create` right on the course.
			await tx.enrollment.upsert({
				where: { username_courseId: { username, courseId: course.id } },
				update: { status: "ACTIVE" },
				create: { username, courseId: course.id },
			});
			return {
				discipline: course.disciplineSlug,
				instructor: course.instructorId,
				edition: course.editionSlug,
				name: course.discipline.name,
			};
		},
	});

	/**
	 * Revokes a passphrase early. Course-owner (or system) only. No caller
	 * yet — it expires on its own in 5 minutes.
	 */
	const remove = op({
		args: [passphrasePK],
		run: async (
			tx: PrismaTx,
			filter: PassphrasePK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const target = await findOne(tx, filter, opts);
			if (!target) throw new Error("passphrase not found");
			await requireManageableCourse(tx, target.courseId, opts, "delete");
			await tx.passphrase.delete({ where: { id: target.id } });
		},
	});

	// No upsert: `value` is server-generated unless pinned, and the only
	// updatable field is `expiresAt`.
	return { create, findOne, findMany, update, redeem, delete: remove };
});

/** The passphrase service, as built by {@link makePassphraseService}. */
export type PassphraseService = ReturnType<typeof makePassphraseService>;

/// Finds the course `ref` names, refusing an actor who may not manage its passphrases.
async function requireManageableCourse(
	tx: PrismaTx,
	ref: CourseRef,
	opts: ServiceOptsWithoutTx,
	action: "read" | "create" | "update" | "delete",
): Promise<{ id: CourseId }> {
	const course = await tx.course.findUnique({
		where: courseRefWhere(ref),
		select: { id: true, instructor: { select: { username: true } } },
	});
	if (!course) throw new NotFound("course");

	// A passphrase is one of the course's operations, not an enrollment
	// row: `enrollment.manage`, so a non-owning admin cannot mint one.
	if (!hasPerm(opts.actor, "enrollment.manage", course))
		throw new NotAllowed(`passphrase.${action}`);

	return { id: course.id as CourseId };
}

//
// Auxiliary functions
//

// Convert a database passphrase record to the public-facing passphrase type.
function toPassphrase(row: DbPassphrase): Passphrase {
	return {
		...row,
		id: row.id as PassphraseId,
		courseId: row.courseId as CourseId,
	};
}
