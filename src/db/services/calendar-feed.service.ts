import type { z } from "zod";
import type { UserActor } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import {
	calendarFeedOwner,
	calendarFeedPK,
	calendarFeedSchema,
	calendarFeedToken,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import { type PrismaClient, type PrismaTx, prisma } from "../client";

//
// Type definitions
//
export type CalendarFeed = z.infer<typeof calendarFeedSchema>;
export type CalendarFeedPK = z.infer<typeof calendarFeedPK>;

/**
 * Data access for calendar feeds, the secret URLs a calendar app subscribes to.
 *
 * Every operation but `resolve` is gated by the `calendar-feed.manage`
 * permission on the owner's username: the owner and SYSTEM pass, everyone else
 * (admins included) gets `NotAllowed`. The CRUD slots are replaced by `get`,
 * `rotate` and `remove`, since a feed has no fields a caller may write.
 */
const defineCalendarFeedService = defineService()(() => {
	/**
	 * Returns the calendar feed of `username`, or `null` when that user has none.
	 *
	 * A username that matches no user also returns `null`.
	 *
	 * @throws {NotAllowed} `calendar-feed.read` when `opts.actor` lacks `calendar-feed.manage` on `username`.
	 * @throws {InvalidData} When `username` is not a valid username.
	 */
	const get = op({
		transaction: false,
		args: [calendarFeedPK],
		returns: calendarFeedSchema.nullable(),
		run: async (
			tx: PrismaTx,
			username: CalendarFeedPK,
			opts: ServiceOptsWithoutTx,
		): Promise<CalendarFeed | null> => {
			if (!hasPerm(opts.actor, "calendar-feed.manage", username)) {
				throw new NotAllowed("calendar-feed.read");
			}
			return tx.calendarFeed.findUnique({ where: { username } });
		},
	});

	/**
	 * Gives `username` a fresh feed token, creating the feed when it has none, and returns the feed.
	 *
	 * The new token comes from `generateToken()` and replaces the old one in the
	 * same write, so the previous URL stops resolving immediately. Rotating an
	 * existing feed keeps its `createdAt` and resets `lastUsedAt` to `null`.
	 *
	 * @throws {NotAllowed} `calendar-feed.update` when `opts.actor` lacks `calendar-feed.manage` on `username`.
	 * @throws {NotFound} When no user has `username` (reachable only by SYSTEM).
	 * @throws {InvalidData} When `username` is not a valid username.
	 */
	const rotate = op({
		args: [calendarFeedPK],
		returns: calendarFeedSchema,
		run: async (
			tx: PrismaTx,
			username: CalendarFeedPK,
			opts: ServiceOptsWithoutTx,
		): Promise<CalendarFeed> => {
			if (!hasPerm(opts.actor, "calendar-feed.manage", username)) {
				throw new NotAllowed("calendar-feed.update");
			}
			const user = await tx.user.findUnique({
				where: { username },
				select: { username: true },
			});
			if (!user) throw new NotFound("user", username);
			const token = generateToken();
			return tx.calendarFeed.upsert({
				where: { username },
				create: { username, token },
				update: { token, lastUsedAt: null },
			});
		},
	});

	/**
	 * Deletes the calendar feed of `username`, so its URL stops resolving; does nothing when there is none.
	 *
	 * @throws {NotAllowed} `calendar-feed.delete` when `opts.actor` lacks `calendar-feed.manage` on `username`.
	 * @throws {InvalidData} When `username` is not a valid username.
	 */
	const remove = op({
		args: [calendarFeedPK],
		run: async (
			tx: PrismaTx,
			username: CalendarFeedPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			if (!hasPerm(opts.actor, "calendar-feed.manage", username)) {
				throw new NotAllowed("calendar-feed.delete");
			}
			await tx.calendarFeed.deleteMany({ where: { username } });
		},
	});

	return { get, rotate, remove };
});

/**
 * Returns the owner of the feed whose token is `token` and stamps the feed's `lastUsedAt` with the current time.
 *
 * Takes no actor and is not an operation of the service: holding the token is
 * the credential, so resolving one is how the caller's identity gets
 * established (ADR 0005). A token that does not match the `calendarFeedToken`
 * schema returns `null` without touching the database, and an unknown token
 * returns `null` too, so the caller cannot tell the two apart. Never throws
 * for bad input.
 *
 * @throws {InvalidData} When the owner read back fails the `calendarFeedOwner` schema.
 */
export async function resolveCalendarFeed(
	client: PrismaClient,
	token: string,
	opts: { tx?: PrismaTx } = {},
): Promise<UserActor | null> {
	if (!calendarFeedToken.safeParse(token).success) return null;
	const db = opts.tx ?? client;
	// Stamp by token first: a feed removed or rotated since the caller
	// built the URL matches no row and resolves to null.
	const stamped = await db.calendarFeed.updateMany({
		where: { token },
		data: { lastUsedAt: new Date() },
	});
	if (stamped.count === 0) return null;
	const feed = await db.calendarFeed.findUnique({
		where: { token },
		select: { user: { select: { username: true, name: true, role: true } } },
	});
	const owner = feed?.user ?? null;
	const parsed = calendarFeedOwner.nullable().safeParse(owner);
	if (!parsed.success) throw InvalidData.fromZodError(parsed.error, owner);
	return owner;
}

/**
 * The calendar feed service of `client` (the shared client by default).
 *
 * Besides the operations it carries `resolve`, bound to the same client; see
 * {@link resolveCalendarFeed}.
 */
export function makeCalendarFeedService(client: PrismaClient = prisma) {
	return {
		...defineCalendarFeedService(client),
		resolve: (token: string, opts?: { tx?: PrismaTx }) =>
			resolveCalendarFeed(client, token, opts),
	};
}

/** The calendar feed service, as built by {@link makeCalendarFeedService}. */
export type CalendarFeedService = ReturnType<typeof makeCalendarFeedService>;
