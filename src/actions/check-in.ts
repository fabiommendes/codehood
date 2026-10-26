import { ActionError, defineAction } from "astro:actions";
import { randomBytes } from "node:crypto";
import type { AstroCookies } from "astro";
import { FULL_ACCESS, type UserActor } from "@/auth/actor";
import { requireUser } from "@/auth/require-user";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/core/constants";
import { CheckInError, FieldError, NotFound } from "@/core/error";
import { checkInCode, checkInSignUp, type RollCallId } from "@/core/schemas";
import { db } from "@/db";
import type { CheckInResult } from "@/db/services/roll-call.service";
import { m } from "@/i18n";
import { CLAIM_TTL_MS, readClaim, signClaim } from "@/utils/pending-check-in";
import { createLimiter } from "@/utils/rate-limit";
import { uniqueConstraintError, withActionErrors } from "./helpers";

/// Name of the cookie that identifies one browser across students.
const DEVICE_COOKIE = "device";

/// Name of the cookie holding a signed check-in claim while the student logs in or signs up.
const CLAIM_COOKIE = "check-in-claim";

/// Wrong codes allowed per user and per IP before check-in refuses further attempts.
const wrongCodes = createLimiter({ max: 10, windowMs: 10 * 60_000 });

/// How each refusal reads to the student.
const MESSAGES: Record<CheckInError["code"], () => string> = {
	"invalid-code": m.errors_check_in_invalid_code,
	expired: m.errors_check_in_expired,
	closed: m.errors_check_in_closed,
	"not-enrolled": m.errors_check_in_not_enrolled,
	dropped: m.errors_check_in_dropped_course,
	"not-student": m.errors_check_in_students_only,
	"claim-expired": m.errors_check_in_claim_expired,
};

/// Attendance as shown on the result page.
export interface AttendanceView {
	title: string;
	startAt: Date;
	/// Name of the discipline, when this check-in enrolled the student.
	joinedCourse: string | null;
}

/// Thrown when a user or an IP made too many wrong attempts.
export class CheckInBlocked extends Error {
	constructor() {
		super(m.errors_check_in_blocked());
		this.name = "CheckInBlocked";
	}
}

/**
 * The text to show for an error thrown while checking in, or `null` if it is not one of ours.
 */
export function checkInMessage(error: unknown): string | null {
	if (error instanceof CheckInError) return MESSAGES[error.code]();
	if (error instanceof NotFound) return MESSAGES["invalid-code"]();
	if (error instanceof CheckInBlocked) return error.message;
	return null;
}

/// Where a request comes from, or a shared bucket when the server cannot tell.
export function clientIp(source: { clientAddress: string }): string {
	try {
		return source.clientAddress || "unknown";
	} catch {
		return "unknown";
	}
}

/// The per-browser device id, set on first use.
function deviceId(cookies: AstroCookies): string {
	const existing = cookies.get(DEVICE_COOKIE)?.value;
	if (existing) return existing;
	const fresh = randomBytes(24).toString("base64url");
	cookies.set(DEVICE_COOKIE, fresh, {
		...SESSION_COOKIE_OPTIONS,
		maxAge: 60 * 60 * 24 * 365 * 5,
	});
	return fresh;
}

/// Limiter keys for an attempt, by user (when logged in) and by IP.
function keysOf(ip: string, username?: string): string[] {
	return username ? [`user:${username}`, `ip:${ip}`] : [`ip:${ip}`];
}

/// Runs `attempt`, refusing blocked keys and charging a wrong code to every key.
async function limited<T>(
	keys: string[],
	attempt: () => Promise<T>,
): Promise<T> {
	if (keys.some((key) => wrongCodes.blocked(key, new Date()))) {
		throw new CheckInBlocked();
	}
	try {
		return await attempt();
	} catch (error) {
		if (error instanceof CheckInError && error.code === "invalid-code") {
			for (const key of keys) wrongCodes.fail(key, new Date());
		}
		throw error;
	}
}

/// Turns a service result into what the result page shows.
async function viewOf(result: CheckInResult): Promise<AttendanceView> {
	let joinedCourse: string | null = null;
	if (result.joined && "id" in result.rollCall) {
		const rollCall = await db.rollCall.findOne(
			{ id: result.rollCall.id },
			FULL_ACCESS,
		);
		const course = rollCall
			? await db.course.findOne({ id: rollCall.courseId }, FULL_ACCESS)
			: null;
		joinedCourse = course?.discipline.name ?? null;
	}
	return { title: result.title, startAt: result.startAt, joinedCourse };
}

/// What a check-in attempt needs from the request.
interface Attempt {
	actor: UserActor;
	cookies: AstroCookies;
	ip: string;
}

/**
 * Marks `actor` present with a typed or scanned code, within the wrong-code limits.
 *
 * @throws {@link CheckInError} If the check-in is refused.
 * @throws {@link CheckInBlocked} If the user or the IP made too many wrong attempts.
 */
export async function register(
	attempt: Attempt & { code: string; rollCallId?: RollCallId },
): Promise<AttendanceView> {
	const { actor, cookies, ip, rollCallId } = attempt;
	const code = attempt.code.trim().toUpperCase();
	const device = deviceId(cookies);
	const result = await limited(keysOf(ip, actor.username), () =>
		db.rollCall.checkIn({ code, rollCallId, deviceId: device }, { actor }),
	);
	return viewOf(result);
}

/**
 * Checks a scanned code before login and, when it is good, keeps a signed claim in a cookie.
 *
 * @returns Whether the roll call also creates accounts.
 * @throws {@link CheckInError} If the code is not accepted now.
 * @throws {@link CheckInBlocked} If the IP made too many wrong attempts.
 */
export async function startClaim(attempt: {
	cookies: AstroCookies;
	ip: string;
	rollCallId: RollCallId;
	code: string;
}): Promise<{ actsAsInvite: boolean }> {
	const { cookies, rollCallId } = attempt;
	const code = attempt.code.trim().toUpperCase();
	const target = await limited(keysOf(attempt.ip), () =>
		db.rollCall.claimTarget({ rollCallId, code }, FULL_ACCESS),
	);
	cookies.set(
		CLAIM_COOKIE,
		signClaim({ rollCallId, claimedAt: new Date() }, target.secret),
		{ ...SESSION_COOKIE_OPTIONS, maxAge: CLAIM_TTL_MS / 1000 },
	);
	return { actsAsInvite: target.actsAsInvite };
}

/**
 * Reads back the claim an earlier scan of `rollCallId` left in the cookie, so a reload after the code rotated keeps going.
 *
 * @returns Whether the roll call also creates accounts, or `null` without a valid claim.
 */
export async function resumeClaim(
	cookies: AstroCookies,
	rollCallId: RollCallId,
): Promise<{ actsAsInvite: boolean } | null> {
	const pending = await pendingClaim(cookies, rollCallId);
	return pending && { actsAsInvite: pending.info.actsAsInvite };
}

/// The claim in the cookie when it is valid for `rollCallId`, else `null`.
async function pendingClaim(cookies: AstroCookies, rollCallId: RollCallId) {
	const value = cookies.get(CLAIM_COOKIE)?.value;
	if (!value) return null;
	const info = await db.rollCall.claimInfo({ rollCallId }, FULL_ACCESS);
	if (!info) return null;
	const claim = readClaim(value, info.secret, new Date());
	return claim?.rollCallId === rollCallId ? { claim, info } : null;
}

/**
 * Completes the check-in a logged-out scan started, if the cookie holds a valid claim for `rollCallId`.
 *
 * The cookie is cleared either way. A claim made before the account existed
 * means the account was created by this flow.
 *
 * @returns The attendance, or `null` when there is no valid claim.
 * @throws {@link CheckInError} If the check-in is refused.
 */
export async function completeClaim(
	attempt: Attempt & { rollCallId: RollCallId },
): Promise<AttendanceView | null> {
	const { actor, cookies, rollCallId } = attempt;
	const pending = await pendingClaim(cookies, rollCallId);
	if (!pending) return null;
	cookies.delete(CLAIM_COOKIE, { path: "/" });
	const user = await db.user.findOne({ username: actor.username }, FULL_ACCESS);
	const result = await db.rollCall.checkInClaim(
		{
			rollCallId,
			claimedAt: pending.claim.claimedAt,
			deviceId: deviceId(cookies),
			accountCreated:
				user !== null && user.createdAt >= pending.claim.claimedAt,
		},
		{ actor },
	);
	return viewOf(result);
}

/// Refusals that are about the code the student typed, not about the student.
const CODE_REFUSALS: ReadonlySet<string> = new Set(["invalid-code", "expired"]);

/// Whether `error` is a refusal that belongs on the code field.
function isCodeRefusal(error: unknown): boolean {
	return (
		error instanceof NotFound ||
		(error instanceof CheckInError && CODE_REFUSALS.has(error.code))
	);
}

export const checkIn = {
	/** Marks the logged-in student present with a typed code. */
	register: defineAction({
		accept: "form",
		input: checkInCode,
		handler: withActionErrors(async (input, context) => {
			const actor = requireUser(context);
			try {
				return await register({
					actor,
					cookies: context.cookies,
					ip: clientIp(context),
					code: input.code,
				});
			} catch (error) {
				const message = checkInMessage(error);
				if (message && isCodeRefusal(error)) {
					throw new FieldError("code", message);
				}
				if (message) throw new ActionError({ code: "BAD_REQUEST", message });
				throw error;
			}
		}),
	}),

	/**
	 * Creates a student account for a roll call that acts as an invite.
	 *
	 * Needs the claim cookie a valid scan left behind. Logs the new account in;
	 * the roll call page completes the check-in.
	 */
	signUp: defineAction({
		accept: "form",
		input: checkInSignUp,
		handler: withActionErrors(async (input, context) => {
			const pending = await pendingClaim(
				context.cookies,
				input.rollCallId as RollCallId,
			);
			if (!pending) {
				throw new ActionError({
					code: "BAD_REQUEST",
					message: MESSAGES["claim-expired"](),
				});
			}
			if (!pending.info.actsAsInvite) {
				throw new ActionError({
					code: "FORBIDDEN",
					message: m.errors_check_in_no_accounts(),
				});
			}
			let username: string;
			try {
				const user = await db.user.create(
					{
						email: input.email,
						username: input.username,
						name: input.name,
						role: "STUDENT",
						password: input.password,
						githubId: input.githubId,
						schoolId: input.schoolId,
					},
					FULL_ACCESS,
				);
				username = user.username;
			} catch (error) {
				throw uniqueConstraintError(error) ?? error;
			}
			const { token, session } = await db.session.create(
				{ username },
				FULL_ACCESS,
			);
			context.cookies.set(SESSION_COOKIE, token, {
				...SESSION_COOKIE_OPTIONS,
				expires: session.expiresAt,
			});
		}),
	}),
};
