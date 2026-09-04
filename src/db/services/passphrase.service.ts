import { customAlphabet } from "nanoid";
import type { z } from "zod";
import { canManageEnrollment } from "@/auth/permissions";
import { SYSTEM } from "@/core/actor";
import { NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type CourseId,
	type PassphraseId,
	passphraseCreate,
	passphraseFilter,
	passphrasePK,
	passphraseSchema,
	passphraseUpdate,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import {
	type Passphrase as DbPassphrase,
	type PrismaClient,
	prisma,
} from "../client";

export type { PassphraseId } from "../../core/schemas";

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes — FR-CRS-041's "live" window.

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

/**
 * A short-lived, course-scoped join code (FR-CRS-040/041) — the in-class
 * counterpart to a classroom invite link.
 *
 * There is no management UI for these: an instructor generates one from
 * `/manage`, reads it out, and it expires on its own five minutes later.
 * `findOne({ value })` is deliberately not actor-filtered, the same
 * reasoning as `InviteService.findOne` by token — the value itself is the
 * credential a joining student presents, not something they're granted read
 * access to separately.
 */
class PassphraseService
	implements
	Crud<{
		entity: Passphrase;
		pkFilter: PassphrasePK;
		create: PassphraseCreate;
		filter: PassphraseFilter;
		update: PassphraseUpdate;
	}> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	private async requireManageableCourse(
		courseId: number,
		opts: ServiceOpts,
		action: "read" | "create" | "update" | "delete",
	): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: courseId },
			select: { instructor: { select: { id: true } } },
		});
		if (!course) {
			throw new Error(`No course with id ${courseId}.`);
		}
		if (
			!canManageEnrollment(opts.actor, {
				instructor: course.instructor,
				enrollments: [],
			})
		) {
			throw new NotAllowed({ action: `${action}-passphrase` });
		}
	}

	/**
	 * Creates a passphrase for `input.courseId`, course-owner (or system)
	 * only.
	 *
	 * `value` defaults to an auto-generated code, retried on the rare
	 * collision against the system-wide unique constraint; an instructor's
	 * own override that collides is refused with a message naming the
	 * conflict, rather than silently regenerated out from under them.
	 */
	@Validate({
		service: true,
		returns: passphraseSchema,
		args: [passphraseCreate],
	})
	async create(
		input: PassphraseCreate,
		opts: ServiceOpts,
	): Promise<Passphrase> {
		await this.requireManageableCourse(input.courseId, opts, "create");
		const client = opts.tx ?? this.prisma;
		const expiresAt = new Date(Date.now() + EXPIRY_MS);

		if (input.value) {
			if (
				await client.passphrase.findUnique({ where: { value: input.value } })
			) {
				throw new Error(
					`Passphrase "${input.value}" is already in use — try another.`,
				);
			}
			return toPassphrase(
				await client.passphrase.create({
					data: { courseId: input.courseId, value: input.value, expiresAt },
				}),
			);
		}

		for (let attempt = 0; attempt < 5; attempt++) {
			const value = generateValue();
			if (await client.passphrase.findUnique({ where: { value } })) continue;
			return toPassphrase(
				await client.passphrase.create({
					data: { courseId: input.courseId, value, expiresAt },
				}),
			);
		}
		throw new Error("Could not generate a unique passphrase — try again.");
	}

	/**
	 * Finds a single passphrase by id or by its value.
	 *
	 * Not actor-filtered on the `value` path — see the class doc. The `id`
	 * path is used internally by `update`/`delete` and isn't reachable from
	 * outside this file today, but stays consistent with every other
	 * service's `findOne`.
	 */
	@Validate({
		service: true,
		returns: passphraseSchema.nullable(),
		args: [passphrasePK],
	})
	async findOne(
		filter: PassphrasePK,
		opts: ServiceOpts,
	): Promise<Passphrase | null> {
		const client = opts.tx ?? this.prisma;
		const by = filter as FillUndefineds<PassphrasePK>; // zod doesn't narrow to a single field, so we do it here

		let row: DbPassphrase | null = null;
		if (by.id !== undefined) {
			row = await client.passphrase.findUnique({ where: { id: by.id } });
		} else if (by.value !== undefined) {
			row = await client.passphrase.findUnique({
				where: { value: by.value },
			});
		}
		return row && toPassphrase(row);
	}

	/**
	 * Lists a course's passphrases, course-owner (or system) only.
	 *
	 * With no `courseId`, only a trusted internal caller (`SYSTEM`) may list
	 * across every course at once. No caller yet — there is no management
	 * UI.
	 */
	@Validate({
		service: true,
		returns: passphraseSchema.array(),
		args: [passphraseFilter],
	})
	async findMany(
		filter: PassphraseFilter,
		opts: ServiceOpts,
	): Promise<Passphrase[]> {
		const client = opts.tx ?? this.prisma;
		if (filter.courseId !== undefined) {
			await this.requireManageableCourse(filter.courseId, opts, "read");
		} else if (opts.actor !== SYSTEM) {
			throw new NotAllowed({ action: "read-passphrase" });
		}
		const rows = await client.passphrase.findMany({
			where: {
				AND: [
					filter.courseId ? { courseId: filter.courseId } : {},
					filter.active ? { expiresAt: { gt: new Date() } } : {},
				],
			},
			orderBy: { createdAt: "desc" },
		});
		return rows.map(toPassphrase);
	}

	/**
	 * Extends (or shortens) how long a passphrase stays live. Course-owner
	 * (or system) only.
	 */
	@Validate({
		service: true,
		returns: passphraseSchema,
		args: [passphrasePK, passphraseUpdate],
	})
	async update(
		filter: PassphrasePK,
		fields: PassphraseUpdate,
		opts: ServiceOpts,
	): Promise<Passphrase> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("passphrase not found");
		await this.requireManageableCourse(target.courseId, opts, "update");
		const client = opts.tx ?? this.prisma;
		return toPassphrase(
			await client.passphrase.update({
				where: { id: target.id },
				data: { expiresAt: fields.expiresAt },
			}),
		);
	}

	/**
	 * Revokes a passphrase early. Course-owner (or system) only. No caller
	 * yet — it expires on its own in 5 minutes.
	 */
	@Validate({ service: true, args: [passphrasePK] })
	async delete(filter: PassphrasePK, opts: ServiceOpts): Promise<void> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("passphrase not found");
		await this.requireManageableCourse(target.courseId, opts, "delete");
		const client = opts.tx ?? this.prisma;
		await client.passphrase.delete({ where: { id: target.id } });
	}
}

export const passphraseService = new PassphraseService();

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
