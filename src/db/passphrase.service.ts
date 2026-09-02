import { customAlphabet } from "nanoid";
import { canManageEnrollment } from "@/auth/permissions";
import type { FillUndefineds } from "@/utils/types";
import {
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	SYSTEM,
	type Update,
} from "./base-service";
import { type Passphrase, type PrismaClient, prisma } from "./client";

const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes — FR-CRS-041's "live" window.

// Uppercase letters and digits only, minus the pairs a student squinting at a
// slide is likely to confuse (0/O, 1/I/L) — this is read aloud and typed once,
// not remembered, so "simple" means "survives a projector" more than "short".
const generateValue = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);

export interface CreatePassphraseInput {
	courseId: number;
	/** Overrides the auto-generated value. Stored verbatim — no format is enforced. */
	value?: string;
}

export type FindPassphraseBy = FillUndefineds<
	{ id: number } | { value: string }
>;

export interface FindPassphrasesBy {
	courseId?: number;
	/** Only passphrases whose `expiresAt` is still in the future. */
	active?: boolean;
}

export interface UpdatePassphraseFilter {
	id: number;
}

/** The only thing worth changing on a live passphrase: how much longer it lasts. */
export interface UpdatePassphraseInput {
	expiresAt: Date;
}

export interface DeletePassphraseFilter {
	id: number;
}

/**
 * A short-lived, course-scoped join code (FR-CRS-040/041) — the in-class
 * counterpart to a classroom invite link. There is no management UI for
 * these: an instructor generates one from `/manage`, reads it out, and it
 * expires on its own five minutes later. `findOne({ value })` is deliberately
 * not actor-filtered, the same reasoning as `InviteService.findOne` by
 * token — the value itself is the credential a joining student presents, not
 * something they're granted read access to separately.
 */
class PassphraseService
	implements
	Create<CreatePassphraseInput, Passphrase>,
	FindOne<FindPassphraseBy, Passphrase>,
	FindMany<FindPassphrasesBy, Passphrase>,
	Update<UpdatePassphraseFilter, UpdatePassphraseInput, Passphrase>,
	Delete<DeletePassphraseFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	private async requireManageableCourse(
		courseId: number,
		opts: ServiceOpts,
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
			throw new ForbiddenError();
		}
	}

	/**
	 * Creates a passphrase for `input.courseId`, course-owner (or system) only.
	 * `value` defaults to an auto-generated code, retried on the rare
	 * collision against the system-wide unique constraint; an instructor's own
	 * override that collides is refused with a message naming the conflict,
	 * rather than silently regenerated out from under them.
	 */
	async create(
		input: CreatePassphraseInput,
		opts: ServiceOpts,
	): Promise<Passphrase> {
		await this.requireManageableCourse(input.courseId, opts);
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
			return client.passphrase.create({
				data: { courseId: input.courseId, value: input.value, expiresAt },
			});
		}

		for (let attempt = 0; attempt < 5; attempt++) {
			const value = generateValue();
			if (await client.passphrase.findUnique({ where: { value } })) continue;
			return client.passphrase.create({
				data: { courseId: input.courseId, value, expiresAt },
			});
		}
		throw new Error("Could not generate a unique passphrase — try again.");
	}

	/**
	 * Not actor-filtered on the `value` path — see the class doc. The `id`
	 * path is used internally by `update`/`delete` and isn't reachable from
	 * outside this file today, but stays consistent with every other
	 * service's `findOne`.
	 */
	async findOne(
		filter: FindPassphraseBy,
		opts: ServiceOpts,
	): Promise<Passphrase | null> {
		const client = opts.tx ?? this.prisma;
		if (filter.id !== undefined) {
			return client.passphrase.findUnique({ where: { id: filter.id } });
		}
		if (filter.value !== undefined) {
			return client.passphrase.findUnique({ where: { value: filter.value } });
		}
		return null;
	}

	/** Lists a course's passphrases, course-owner (or system) only. No caller yet — there is no management UI. */
	async findMany(
		filter: FindPassphrasesBy,
		opts: ServiceOpts,
	): Promise<Passphrase[]> {
		const client = opts.tx ?? this.prisma;
		if (filter.courseId !== undefined) {
			await this.requireManageableCourse(filter.courseId, opts);
		} else if (opts.actor !== SYSTEM) {
			// No course named: only a trusted internal caller may list across
			// every course at once.
			throw new ForbiddenError();
		}
		return client.passphrase.findMany({
			where: {
				AND: [
					filter.courseId ? { courseId: filter.courseId } : {},
					filter.active ? { expiresAt: { gt: new Date() } } : {},
				],
			},
			orderBy: { createdAt: "desc" },
		});
	}

	/** Extends (or shortens) how long a passphrase stays live. Course-owner (or system) only. */
	async update(
		filter: UpdatePassphraseFilter,
		fields: UpdatePassphraseInput,
		opts: ServiceOpts,
	): Promise<Passphrase> {
		const passphrase = await this.prisma.passphrase.findUnique({
			where: { id: filter.id },
		});
		if (!passphrase) {
			throw new Error(`No passphrase with id ${filter.id}.`);
		}
		await this.requireManageableCourse(passphrase.courseId, opts);
		const client = opts.tx ?? this.prisma;
		return client.passphrase.update({
			where: { id: filter.id },
			data: { expiresAt: fields.expiresAt },
		});
	}

	/** Revokes a passphrase early. Course-owner (or system) only. No caller yet — it expires on its own in 5 minutes. */
	async delete(
		filter: DeletePassphraseFilter,
		opts: ServiceOpts,
	): Promise<void> {
		const passphrase = await this.prisma.passphrase.findUnique({
			where: { id: filter.id },
		});
		if (!passphrase) {
			throw new Error(`No passphrase with id ${filter.id}.`);
		}
		await this.requireManageableCourse(passphrase.courseId, opts);
		const client = opts.tx ?? this.prisma;
		await client.passphrase.delete({ where: { id: filter.id } });
	}
}

export const passphraseService = new PassphraseService();
export type { Passphrase };
