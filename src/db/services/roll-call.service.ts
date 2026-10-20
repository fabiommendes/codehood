/**
 * The roll call of a calendar event: opened by the instructor, marked by the
 * students present.
 *
 * Writes, `open`, `close` and `currentCode` need the `roll-call.manage`
 * permission. Whoever holds it reads every attendance; a student who may read
 * the course's contents reads their own entry only. `secret` and `deviceHash`
 * leave the service only through `claimTarget` and `claimInfo`, which serve the
 * signed pending check-in cookie.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { CheckInError, InvalidData, NotAllowed, NotFound } from "@/core/error";
import {
	type CourseId,
	type CourseRef,
	type calendarEventPK,
	checkInClaimInput,
	checkInInput,
	checkInResultSchema,
	courseAttendanceSchema,
	courseRef,
	type RollCallId,
	rollCallCreate,
	rollCallFilter,
	rollCallPK,
	rollCallSchema,
	rollCallUpdate,
} from "@/core/schemas";
import { rollCallId } from "@/core/schemas/base";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { m } from "@/i18n";
import { codeAt, generateSecret, isCodeValid } from "@/services/roll-call-code";
import { CLAIM_TTL_MS } from "@/utils/pending-check-in";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { courseRefWhere, invalidIfExists, valueOrNotFound } from "../utils";

export type { RollCallId } from "@/core/schemas";

//
// Type definitions
//
export type RollCallCreate = z.input<typeof rollCallCreate>;
export type RollCall = z.infer<typeof rollCallSchema>;
export type RollCallFilter = z.infer<typeof rollCallFilter>;
export type RollCallPK = z.infer<typeof rollCallPK>;
export type RollCallUpdate = z.infer<typeof rollCallUpdate>;
export type CourseAttendance = z.infer<typeof courseAttendanceSchema>;
export type CheckInInput = z.input<typeof checkInInput>;
export type CheckInClaimInput = z.input<typeof checkInClaimInput>;
export type CheckInResult = z.infer<typeof checkInResultSchema>;

/// How long a roll call stays open after it is created or reopened.
const OPEN_MS = 15 * 60_000;

/// How far back an old code is still recognized, to tell "expired" from "wrong".
const EXPIRY_LOOKBACK_MS = OPEN_MS;

/// Step between the instants tried when looking for an expired code.
const EXPIRY_STEP_MS = 15_000;

/// What `claimTarget` takes.
const claimTargetInput = z.object({ rollCallId, code: z.string() });

/// What `claimTarget` returns.
const claimTargetSchema = z.object({
	secret: z.string(),
	actsAsInvite: z.boolean(),
});

/// What `currentCode` returns.
const currentCodeSchema = z.object({
	code: z.string(),
	nextChangeAt: z.date(),
});

/// The event shape the permission predicates and the output need.
const eventSelect = {
	courseId: true,
	week: true,
	timeSlot: { select: { slug: true } },
	course: {
		select: {
			id: true,
			instructor: { select: { username: true } },
			enrollments: {
				where: { status: "ACTIVE" as const },
				select: { username: true },
			},
		},
	},
} satisfies Prisma.CalendarEventSelect;

/// A roll call row with its event, course and attendances.
const rollCallSelect = {
	id: true,
	secret: true,
	actsAsInvite: true,
	closesAt: true,
	createdAt: true,
	updatedAt: true,
	event: { select: eventSelect },
	attendances: {
		select: {
			username: true,
			source: true,
			joined: true,
			note: true,
			deviceHash: true,
			createdAt: true,
		},
		orderBy: { username: "asc" },
	},
} satisfies Prisma.RollCallSelect;

type DbRollCall = Prisma.RollCallGetPayload<{ select: typeof rollCallSelect }>;

export class RollCallService extends CrudBase<{
	entity: RollCall;
	pkFilter: RollCallPK;
	create: RollCallCreate;
	filter: RollCallFilter;
	update: RollCallUpdate;
	upsert: false;
}> {
	/**
	 * Opens the roll call of an event for 15 min.
	 *
	 * @throws {@link NotFound} If the event does not exist.
	 * @throws {@link NotAllowed} If the actor may not manage the course's roll calls.
	 * @throws {@link InvalidData} If the event is a holiday or cancelled, or already has a roll call.
	 */
	@Validate({
		service: true,
		returns: rollCallSchema,
		args: [undefined, rollCallCreate],
	})
	protected override async createTx(
		tx: PrismaTx,
		input: RollCallCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<RollCall> {
		const event = valueOrNotFound(
			"calendar-event",
			await tx.calendarEvent.findFirst({
				where: await eventWhere(tx, input.event),
				select: { id: true, kind: true, ...eventSelect },
			}),
		);
		ensurePerm(opts.actor, "roll-call.manage", event.course);

		if (event.kind === "HOLIDAY" || event.kind === "CANCELLED") {
			throw new InvalidData({
				event: [
					{
						code: "invalid",
						message:
							event.kind === "HOLIDAY"
								? m.errors_holiday_has_no_roll_call()
								: m.errors_cancelled_has_no_roll_call(),
					},
				],
			});
		}

		const row = await invalidIfExists(() =>
			tx.rollCall.create({
				data: {
					eventId: event.id,
					secret: generateSecret(),
					actsAsInvite: input.actsAsInvite ?? false,
					closesAt: new Date(Date.now() + OPEN_MS),
				},
				select: rollCallSelect,
			}),
		);
		return fromDb(row, opts.actor);
	}

	/**
	 * Finds a roll call by id, or by course, week and time slot.
	 *
	 * A student reads their own attendance only.
	 *
	 * @throws {@link NotFound} If the filter references a course that does not exist.
	 * @throws {@link NotAllowed} If the roll call exists but the actor may not read the course.
	 */
	@Validate({
		service: true,
		returns: rollCallSchema.nullable(),
		args: [undefined, rollCallPK],
	})
	protected override async findOneTx(
		tx: PrismaTx,
		filter: RollCallPK,
		opts: ServiceOptsWithoutTx,
	): Promise<RollCall | null> {
		const row = await tx.rollCall.findFirst({
			where: await rollCallWhere(tx, filter),
			select: rollCallSelect,
		});
		if (!row) return null;

		ensurePerm(opts.actor, "course.read-contents", row.event.course);
		return fromDb(row, opts.actor);
	}

	/**
	 * Lists the roll calls of a course in date order.
	 *
	 * A student reads their own attendance only.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} If the actor may not read the course.
	 */
	@Validate({
		service: true,
		returns: rollCallSchema.array(),
		args: [undefined, rollCallFilter],
	})
	protected override async findManyTx(
		tx: PrismaTx,
		filter: RollCallFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<RollCall[]> {
		const course = await readableCourse(tx, filter.course, opts.actor);

		const rows = await tx.rollCall.findMany({
			where: { event: { courseId: course.id } },
			select: rollCallSelect,
			orderBy: { event: { startAt: "asc" } },
		});
		return rows.map((row) => fromDb(row, opts.actor));
	}

	/**
	 * Merges `fields.attendances` into the stored ones and sets `actsAsInvite`.
	 *
	 * An object creates a MANUAL attendance or changes the note of an existing
	 * one (its source stays); `null` removes the student; an absent key is left
	 * alone. Everything is written or nothing is.
	 *
	 * @throws {@link NotFound} If the roll call does not exist.
	 * @throws {@link NotAllowed} If the actor may not manage the course's roll calls.
	 * @throws {@link InvalidData} If a student has no enrollment in the course.
	 */
	@Validate({
		service: true,
		returns: rollCallSchema,
		args: [undefined, rollCallPK, rollCallUpdate],
	})
	protected override async updateTx(
		tx: PrismaTx,
		filter: RollCallPK,
		fields: RollCallUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<RollCall> {
		const current = await manageable(tx, filter, opts.actor);
		const entries = Object.entries(fields.attendances ?? {});

		const marked = entries.filter(([, entry]) => entry !== null);
		await checkEnrolled(
			tx,
			current.event.courseId,
			marked.map(([name]) => name),
		);

		if (fields.actsAsInvite !== undefined) {
			await tx.rollCall.update({
				where: { id: current.id },
				data: { actsAsInvite: fields.actsAsInvite },
			});
		}

		for (const [name, entry] of entries) {
			const where = {
				rollCallId_username: { rollCallId: current.id, username: name },
			};
			if (entry === null) {
				await tx.attendance.deleteMany({
					where: { rollCallId: current.id, username: name },
				});
			} else if (await tx.attendance.findUnique({ where })) {
				if (entry.note !== undefined) {
					await tx.attendance.update({
						where,
						data: { note: entry.note },
					});
				}
			} else {
				await tx.attendance.create({
					data: {
						rollCallId: current.id,
						username: name,
						source: "MANUAL",
						note: entry.note ?? null,
					},
				});
			}
		}
		return this.readWhole(tx, current.id, opts.actor);
	}

	/**
	 * Deletes a roll call and its attendances.
	 *
	 * @throws {@link NotFound} If the roll call does not exist.
	 * @throws {@link NotAllowed} If the actor may not manage the course's roll calls.
	 */
	@Validate({ service: true, args: [undefined, rollCallPK] })
	protected override async deleteTx(
		tx: PrismaTx,
		filter: RollCallPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const current = await manageable(tx, filter, opts.actor);
		await tx.rollCall.delete({ where: { id: current.id } });
	}

	/**
	 * Reopens the roll call for 15 min from now.
	 *
	 * @throws {@link NotFound} If the roll call does not exist.
	 * @throws {@link NotAllowed} If the actor may not manage the course's roll calls.
	 */
	@Validate({
		service: true,
		returns: rollCallSchema,
		args: [rollCallPK],
	})
	open<Opt extends ServiceOpts>(
		filter: RollCallPK,
		opts: Opt,
	): Promise<RollCall> {
		return this.setClosesAt(filter, opts, () => new Date(Date.now() + OPEN_MS));
	}

	/**
	 * Closes the roll call now.
	 *
	 * @throws {@link NotFound} If the roll call does not exist.
	 * @throws {@link NotAllowed} If the actor may not manage the course's roll calls.
	 */
	@Validate({
		service: true,
		returns: rollCallSchema,
		args: [rollCallPK],
	})
	close<Opt extends ServiceOpts>(
		filter: RollCallPK,
		opts: Opt,
	): Promise<RollCall> {
		return this.setClosesAt(filter, opts, () => new Date());
	}

	/**
	 * Returns the code on the instructor's screen and the instant it changes.
	 *
	 * @throws {@link NotFound} If the roll call does not exist.
	 * @throws {@link NotAllowed} If the actor may not manage the course's roll calls.
	 */
	@Validate({
		service: true,
		returns: currentCodeSchema,
		args: [rollCallPK],
	})
	currentCode<Opt extends ServiceOpts>(
		filter: RollCallPK,
		opts: Opt,
	): Promise<{ code: string; nextChangeAt: Date }> {
		return this.$transaction(opts, async (tx, scoped) => {
			const current = await manageable(tx, filter, scoped.actor);
			return codeAt(current.secret, new Date());
		});
	}

	/**
	 * Builds the attendance report of a course.
	 *
	 * Lists every enrolled student, DROPPED included, against every event that
	 * had a roll call. An event before the student's enrollment without an
	 * attendance is `before-enrollment`; it still counts in `total`. A student
	 * gets only their own row.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} If the actor may not read the course.
	 */
	@Validate({
		service: true,
		returns: courseAttendanceSchema,
		args: [courseRef],
	})
	courseAttendance<Opt extends ServiceOpts>(
		course: CourseRef,
		opts: Opt,
	): Promise<CourseAttendance> {
		return this.$transaction(opts, async (tx, scoped) => {
			const found = await readableCourse(tx, course, scoped.actor);
			const id = found.id;

			const events = await tx.calendarEvent.findMany({
				where: { courseId: id, rollCall: { isNot: null } },
				select: {
					week: true,
					title: true,
					startAt: true,
					timeSlot: { select: { slug: true } },
					rollCall: { select: { attendances: { select: { username: true } } } },
				},
				orderBy: { startAt: "asc" },
			});
			const enrollments = await tx.enrollment.findMany({
				where: {
					courseId: id,
					...(hasPerm(scoped.actor, "roll-call.manage", found)
						? {}
						: { username: usernameOf(scoped.actor) }),
				},
				select: {
					status: true,
					createdAt: true,
					user: {
						select: {
							username: true,
							name: true,
							email: true,
							schoolId: true,
						},
					},
				},
				orderBy: { username: "asc" },
			});

			const keyOf = (e: { week: number; timeSlot: { slug: string } }) =>
				`${e.week}/${e.timeSlot.slug}`;
			return {
				events: events.map((e) => ({
					week: e.week,
					timeSlot: e.timeSlot.slug,
					title: e.title,
					startAt: e.startAt,
				})),
				students: enrollments.map((enrollment) => {
					const cells: Record<
						string,
						"present" | "absent" | "before-enrollment"
					> = {};
					let present = 0;
					for (const event of events) {
						const attended = event.rollCall?.attendances.some(
							(a) => a.username === enrollment.user.username,
						);
						if (attended) present++;
						cells[keyOf(event)] = attended
							? "present"
							: event.startAt < enrollment.createdAt
								? "before-enrollment"
								: "absent";
					}
					return {
						...enrollment.user,
						status: enrollment.status,
						cells,
						present,
						total: events.length,
					};
				}),
			};
		});
	}

	/**
	 * Marks the acting student present with a code typed or scanned now.
	 *
	 * Without `rollCallId`, the code is matched against every open roll call,
	 * preferring a course the student is enrolled in. A repeat check-in changes
	 * nothing.
	 *
	 * @throws {@link CheckInError} If the check-in is refused.
	 */
	@Validate({
		service: true,
		returns: checkInResultSchema,
		args: [checkInInput],
	})
	checkIn<Opt extends ServiceOpts>(
		input: CheckInInput,
		opts: Opt,
	): Promise<CheckInResult> {
		return this.$transaction(opts, async (tx, scoped) => {
			const student = studentOf(scoped.actor);
			const now = new Date();
			const target =
				input.rollCallId === undefined
					? await matchOpenRollCall(tx, student, input.code, now)
					: await verifyRollCall(tx, input.rollCallId, input.code, now);
			return markPresent(tx, student, target, input.deviceId, false);
		});
	}

	/**
	 * Completes a check-in whose code was verified at `claimedAt`, after login or signup.
	 *
	 * The code and the window are not checked again; the claim itself lasts 10 min.
	 *
	 * @throws {@link CheckInError} If the check-in is refused.
	 * @throws {@link NotFound} If the roll call does not exist.
	 */
	@Validate({
		service: true,
		returns: checkInResultSchema,
		args: [checkInClaimInput],
	})
	checkInClaim<Opt extends ServiceOpts>(
		input: CheckInClaimInput,
		opts: Opt,
	): Promise<CheckInResult> {
		return this.$transaction(opts, async (tx, scoped) => {
			const student = studentOf(scoped.actor);
			if (Date.now() - input.claimedAt.getTime() >= CLAIM_TTL_MS) {
				throw new CheckInError("claim-expired");
			}
			const target = valueOrNotFound(
				"roll-call",
				await tx.rollCall.findFirst({
					where: { id: input.rollCallId },
					select: checkInSelect,
				}),
			);
			return markPresent(
				tx,
				student,
				target,
				input.deviceId,
				input.accountCreated,
			);
		});
	}

	/**
	 * Verifies a scanned code for a roll call and returns what the pending-claim cookie needs.
	 *
	 * Meant for server code that holds no student session yet; the returned
	 * `secret` must never reach the client.
	 *
	 * @throws {@link NotAllowed} Unless the actor is `SYSTEM`.
	 * @throws {@link CheckInError} If the roll call is closed or the code is not accepted now.
	 */
	@Validate({
		service: true,
		returns: claimTargetSchema,
		args: [claimTargetInput],
	})
	claimTarget<Opt extends ServiceOpts>(
		input: z.input<typeof claimTargetInput>,
		opts: Opt,
	): Promise<z.infer<typeof claimTargetSchema>> {
		requireSystem(opts.actor);
		return this.$transaction(opts, async (tx) => {
			const target = await verifyRollCall(
				tx,
				input.rollCallId,
				input.code,
				new Date(),
			);
			return { secret: target.secret, actsAsInvite: target.actsAsInvite };
		});
	}

	/**
	 * Returns what signs and gates the pending claims of a roll call, or `null` when it does not exist.
	 *
	 * The secret must never reach the client.
	 *
	 * @throws {@link NotAllowed} Unless the actor is `SYSTEM`.
	 */
	@Validate({
		service: true,
		returns: claimTargetSchema.nullable(),
		args: [z.object({ rollCallId })],
	})
	claimInfo<Opt extends ServiceOpts>(
		input: { rollCallId: RollCallId },
		opts: Opt,
	): Promise<z.infer<typeof claimTargetSchema> | null> {
		requireSystem(opts.actor);
		return this.$transaction(opts, async (tx) => {
			const row = await tx.rollCall.findUnique({
				where: { id: input.rollCallId },
				select: { secret: true, actsAsInvite: true },
			});
			return row ?? null;
		});
	}

	// Private utilities ---------------------------------------------------------

	/// Sets `closesAt` to the instant `when` returns.
	private setClosesAt<Opt extends ServiceOpts>(
		filter: RollCallPK,
		opts: Opt,
		when: () => Date,
	): Promise<RollCall> {
		return this.$transaction(opts, async (tx, scoped) => {
			const current = await manageable(tx, filter, scoped.actor);
			await tx.rollCall.update({
				where: { id: current.id },
				data: { closesAt: when() },
			});
			return this.readWhole(tx, current.id, scoped.actor);
		});
	}

	/// Reads a roll call back as `actor` sees it.
	private async readWhole(
		tx: PrismaTx,
		id: RollCallId,
		actor: Actor,
	): Promise<RollCall> {
		const row = await tx.rollCall.findUniqueOrThrow({
			where: { id },
			select: rollCallSelect,
		});
		return fromDb(row, actor);
	}
}

//
// Auxiliary functions
//

/// The `where` matching the calendar event `filter` references.
async function eventWhere(
	tx: PrismaTx,
	filter: z.input<typeof calendarEventPK>,
): Promise<Prisma.CalendarEventWhereInput> {
	if ("id" in filter) return { id: filter.id };

	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(filter.course as CourseRef),
			select: { id: true },
		}),
	);
	return {
		courseId: course.id,
		week: filter.week,
		...(typeof filter.timeSlot === "number"
			? { timeSlotId: filter.timeSlot }
			: { timeSlot: { slug: filter.timeSlot } }),
	};
}

/// The `where` matching whichever of the primary keys `filter` carries.
async function rollCallWhere(
	tx: PrismaTx,
	filter: RollCallPK,
): Promise<Prisma.RollCallWhereInput> {
	if ("id" in filter) return { id: filter.id };
	return { event: await eventWhere(tx, filter) };
}

/// Finds the roll call a write targets, refusing an actor who may not manage it.
async function manageable(tx: PrismaTx, filter: RollCallPK, actor: Actor) {
	const row = valueOrNotFound(
		"roll-call",
		await tx.rollCall.findFirst({
			where: await rollCallWhere(tx, filter),
			select: { id: true, secret: true, event: { select: eventSelect } },
		}),
	);
	ensurePerm(actor, "roll-call.manage", row.event.course);
	return row;
}

/// Finds a course the actor may read.
async function readableCourse(tx: PrismaTx, ref: CourseRef, actor: Actor) {
	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: {
				id: true,
				instructor: { select: { username: true } },
				enrollments: {
					where: { status: "ACTIVE" as const },
					select: { username: true },
				},
			},
		}),
	);
	ensurePerm(actor, "course.read-contents", course);
	return course;
}

/// Refuses usernames with no enrollment in the course, listing each of them.
async function checkEnrolled(
	tx: PrismaTx,
	courseId: number,
	names: string[],
): Promise<void> {
	if (names.length === 0) return;
	const enrolled = await tx.enrollment.findMany({
		where: { courseId, username: { in: names } },
		select: { username: true },
	});
	const known = new Set(enrolled.map((e) => e.username));
	const unknown = names.filter((name) => !known.has(name));
	if (unknown.length === 0) return;

	throw new InvalidData({
		attendances: unknown.map((name) => ({
			code: "not-exists" as const,
			message: m.errors_not_enrolled_in_course({ username: name }),
		})),
	});
}

/// What a check-in needs to know about a roll call.
const checkInSelect = {
	id: true,
	secret: true,
	actsAsInvite: true,
	closesAt: true,
	event: {
		select: { courseId: true, title: true, startAt: true },
	},
} satisfies Prisma.RollCallSelect;

type CheckInTarget = Prisma.RollCallGetPayload<{
	select: typeof checkInSelect;
}>;

/// The username of a student actor.
function studentOf(actor: Actor): string {
	if (typeof actor === "symbol" || actor.role !== "STUDENT") {
		throw new CheckInError("not-student", m.errors_check_in_students_only());
	}
	return actor.username;
}

/// Finds the roll call `id` and checks it is open and `code` is accepted now.
async function verifyRollCall(
	tx: PrismaTx,
	id: number,
	code: string,
	now: Date,
): Promise<CheckInTarget> {
	const target = await tx.rollCall.findFirst({
		where: { id },
		select: checkInSelect,
	});
	if (!target) throw new CheckInError("invalid-code");
	if (target.closesAt <= now) throw new CheckInError("closed");
	if (isCodeValid(target.secret, code, now)) return target;

	for (
		let back = EXPIRY_STEP_MS;
		back <= EXPIRY_LOOKBACK_MS;
		back += EXPIRY_STEP_MS
	) {
		if (isCodeValid(target.secret, code, new Date(now.getTime() - back))) {
			throw new CheckInError("expired");
		}
	}
	throw new CheckInError("invalid-code");
}

/// Finds the open roll call that accepts `code`, preferring the student's courses.
async function matchOpenRollCall(
	tx: PrismaTx,
	username: string,
	code: string,
	now: Date,
): Promise<CheckInTarget> {
	const open = await tx.rollCall.findMany({
		where: { closesAt: { gt: now } },
		select: checkInSelect,
	});
	const matches = open.filter((r) => isCodeValid(r.secret, code, now));
	const [first] = matches;
	if (!first) throw new CheckInError("invalid-code");
	if (matches.length === 1) return first;

	const enrolled = await tx.enrollment.findMany({
		where: {
			username,
			courseId: { in: matches.map((r) => r.event.courseId) },
		},
		select: { courseId: true },
	});
	const courses = new Set(enrolled.map((e) => e.courseId));
	return matches.find((r) => courses.has(r.event.courseId)) ?? first;
}

/// Records the attendance of `username`, enrolling them first when the roll call invites.
async function markPresent(
	tx: PrismaTx,
	username: string,
	target: CheckInTarget,
	deviceId: string,
	accountCreated: boolean,
): Promise<CheckInResult> {
	const courseId = target.event.courseId;
	const enrollment = await tx.enrollment.findUnique({
		where: { username_courseId: { username, courseId } },
		select: { status: true },
	});
	if (enrollment?.status === "DROPPED") {
		throw new CheckInError("dropped", m.errors_check_in_dropped());
	}

	let joined: "ENROLLMENT" | "ACCOUNT" | null = null;
	if (!enrollment) {
		if (!target.actsAsInvite) throw new CheckInError("not-enrolled");
		await tx.enrollment.create({ data: { username, courseId } });
		joined = accountCreated ? "ACCOUNT" : "ENROLLMENT";
	}

	const existing = await tx.attendance.findUnique({
		where: { rollCallId_username: { rollCallId: target.id, username } },
		select: { joined: true },
	});
	if (!existing) {
		await tx.attendance.create({
			data: {
				rollCallId: target.id,
				username,
				source: "CODE",
				deviceHash: createHash("sha256").update(deviceId).digest("hex"),
				joined,
			},
		});
	}
	return {
		rollCall: { id: target.id as RollCallId },
		title: target.event.title,
		startAt: target.event.startAt,
		joined: existing ? existing.joined : joined,
	};
}

/// The username of a user actor, or an empty string for SYSTEM.
function usernameOf(actor: Actor): string {
	return typeof actor === "symbol" ? "" : actor.username;
}

/// Converts a row into the roll call entity as `actor` may see it.
function fromDb(row: DbRollCall, actor: Actor): RollCall {
	const manager = hasPerm(actor, "roll-call.manage", row.event.course);
	const visible = manager
		? row.attendances
		: row.attendances.filter((a) => a.username === usernameOf(actor));

	const attendances: RollCall["attendances"] = {};
	for (const a of visible) {
		const sharedWith =
			manager && a.deviceHash !== null
				? row.attendances
						.filter(
							(other) =>
								other.deviceHash === a.deviceHash &&
								other.username !== a.username,
						)
						.map((other) => other.username)
				: [];
		attendances[a.username] = {
			source: a.source,
			joined: a.joined,
			note: a.note,
			sharedWith,
			createdAt: a.createdAt,
		};
	}

	return {
		id: row.id as RollCallId,
		courseId: row.event.courseId as CourseId,
		week: row.event.week,
		timeSlot: row.event.timeSlot.slug,
		actsAsInvite: row.actsAsInvite,
		closesAt: row.closesAt,
		attendances,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/// Refuses every actor but `SYSTEM`: the caller is about to receive a secret.
function requireSystem(actor: Actor): void {
	if (actor !== SYSTEM) throw new NotAllowed("roll-call.manage");
}
