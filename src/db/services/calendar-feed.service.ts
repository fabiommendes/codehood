import type { z } from "zod";
import type { UserActor } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { NotAllowed, NotFound } from "@/core/error";
import {
	calendarFeedOwner,
	calendarFeedPK,
	calendarFeedSchema,
	calendarFeedToken,
} from "@/core/schemas";
import type { ServiceOpts } from "@/db/base-service";
import { Validate } from "@/utils/validate";
import { type PrismaClient, type PrismaTx, prisma } from "../client";

//
// Type definitions
//
export type CalendarFeed = z.infer<typeof calendarFeedSchema>;
export type CalendarFeedPK = z.infer<typeof calendarFeedPK>;

/**
 * Data access for calendar feeds, the secret URLs a calendar app subscribes to.
 *
 * Every method but {@link CalendarFeedService.resolve} is gated by the
 * `calendar-feed.manage` permission on the owner's username: the owner and
 * SYSTEM pass, everyone else (admins included) gets `NotAllowed`. The CRUD
 * slots are replaced by `get`, `rotate` and `remove`, since a feed has no
 * fields a caller may write.
 */
export class CalendarFeedService {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/// No create: a feed is minted by `rotate`, which also covers the first one.
	create(_input: never, _opts: ServiceOpts): Promise<never> {
		throw new Error("Method not implemented.");
	}

	/// No findOne: `get` reads the single feed a user may have.
	findOne(_filter: never, _opts: ServiceOpts): Promise<never> {
		throw new Error("Method not implemented.");
	}

	/// No findMany: a feed is only ever read by its owner, one at a time.
	findMany(_filter: never, _opts: ServiceOpts): Promise<never> {
		throw new Error("Method not implemented.");
	}

	/// No update: the token is the only mutable field, and `rotate` replaces it.
	update(_filter: never, _data: never, _opts: ServiceOpts): Promise<never> {
		throw new Error("Method not implemented.");
	}

	/// No upsert: `rotate` is the create-or-replace operation.
	upsert(_input: never, _opts: ServiceOpts): Promise<never> {
		throw new Error("Method not implemented.");
	}

	/// No delete: `remove` deletes the feed and is a no-op without one.
	delete(_filter: never, _opts: ServiceOpts): Promise<never> {
		throw new Error("Method not implemented.");
	}

	/**
	 * Returns the calendar feed of `username`, or `null` when that user has none.
	 *
	 * A username that matches no user also returns `null`.
	 *
	 * @throws {NotAllowed} `calendar-feed.read` when `opts.actor` lacks `calendar-feed.manage` on `username`.
	 * @throws {InvalidData} When `username` is not a valid username.
	 */
	@Validate({
		service: true,
		returns: calendarFeedSchema.nullable(),
		args: [calendarFeedPK],
	})
	async get(
		username: CalendarFeedPK,
		opts: ServiceOpts,
	): Promise<CalendarFeed | null> {
		if (!hasPerm(opts.actor, "calendar-feed.manage", username)) {
			throw new NotAllowed("calendar-feed.read");
		}
		const client = opts.tx ?? this.prisma;
		return client.calendarFeed.findUnique({ where: { username } });
	}

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
	@Validate({
		service: true,
		returns: calendarFeedSchema,
		args: [calendarFeedPK],
	})
	async rotate(
		username: CalendarFeedPK,
		opts: ServiceOpts,
	): Promise<CalendarFeed> {
		if (!hasPerm(opts.actor, "calendar-feed.manage", username)) {
			throw new NotAllowed("calendar-feed.update");
		}
		const client = opts.tx ?? this.prisma;
		const user = await client.user.findUnique({
			where: { username },
			select: { username: true },
		});
		if (!user) throw new NotFound("user", username);
		const token = generateToken();
		return client.calendarFeed.upsert({
			where: { username },
			create: { username, token },
			update: { token, lastUsedAt: null },
		});
	}

	/**
	 * Deletes the calendar feed of `username`, so its URL stops resolving; does nothing when there is none.
	 *
	 * @throws {NotAllowed} `calendar-feed.delete` when `opts.actor` lacks `calendar-feed.manage` on `username`.
	 * @throws {InvalidData} When `username` is not a valid username.
	 */
	@Validate({ service: true, args: [calendarFeedPK] })
	async remove(username: CalendarFeedPK, opts: ServiceOpts): Promise<void> {
		if (!hasPerm(opts.actor, "calendar-feed.manage", username)) {
			throw new NotAllowed("calendar-feed.delete");
		}
		const client = opts.tx ?? this.prisma;
		await client.calendarFeed.deleteMany({ where: { username } });
	}

	/**
	 * Returns the owner of the feed whose token is `token` and stamps the feed's `lastUsedAt` with the current time.
	 *
	 * Not actor-gated: holding the token is the credential. A token that does
	 * not match the `calendarFeedToken` schema returns `null` without
	 * touching the database, and an unknown token returns `null` too, so the
	 * caller cannot tell the two apart. Never throws for bad input.
	 */
	@Validate({ returns: calendarFeedOwner.nullable() })
	async resolve(
		token: string,
		opts: { tx?: PrismaTx } = {},
	): Promise<UserActor | null> {
		if (!calendarFeedToken.safeParse(token).success) return null;
		const client = opts.tx ?? this.prisma;
		const feed = await client.calendarFeed.findUnique({
			where: { token },
			select: {
				username: true,
				user: { select: { username: true, name: true, role: true } },
			},
		});
		if (!feed) return null;
		await client.calendarFeed.update({
			where: { username: feed.username },
			data: { lastUsedAt: new Date() },
		});
		return feed.user;
	}
}
