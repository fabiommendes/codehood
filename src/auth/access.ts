// Access as an ordered value. A service loads a row, asks one of the
// `*Access` functions how much of it the actor gets, and `requireAccess` turns
// the shortfall into the error: nothing visible is `NotFound`, visible but
// not enough is `NotAllowed`. Pure: no database, the decision stays in the service.

import {
	type CourseWithEnrollment,
	hasPerm,
	type ResponseWithCourse,
} from "@/auth/permissions";
import {
	type ActionCode,
	NotAllowed,
	NotFound,
	PreconditionFailed,
} from "@/core/error";
import type { Exam } from "@/db/services/exam.service";
import { hiddenFromStudents } from "@/services/exam-state";
import { type QuestionStatus, visibility } from "@/services/question-status";
import type { Actor } from "./actor";

/**
 * How much of a row an actor gets.
 *
 * `none`: the row is invisible to them. `see`: they may know it exists but
 * not read it. `read`: they get the read view. `write`: they get the whole
 * document and may change it.
 */
export type Access = "none" | "see" | "read" | "write";

/// The levels from least to most.
export const ACCESS_ORDER = ["none", "see", "read", "write"] as const;

/// Position of `level` in {@link ACCESS_ORDER}.
function rank(level: Access): number {
	return ACCESS_ORDER.indexOf(level);
}

/** The highest of `levels`, or `none` when there are none. */
export function maxAccess(...levels: Access[]): Access {
	return levels.reduce<Access>(
		(best, level) => (rank(level) > rank(best) ? level : best),
		"none",
	);
}

/**
 * The error `access` earns when `needed` is asked, or `undefined` when it suffices.
 *
 * `opts.target` is recorded on the `NotAllowed`. `none` is `NotFound` of the resource `action` names (`exam.update` is an
 * `exam`); any other shortfall is `NotAllowed(action)`.
 *
 * A row the actor cannot see answers as a missing one (ADR 0013): when
 * `opts.expectedUpdatedAt` is a `Date`, `none` is a {@link PreconditionFailed}
 * carrying `null`, so the version check does not reveal that the row exists.
 */
export function accessError(
	access: Access,
	needed: "read" | "write",
	action: ActionCode,
	opts?: { target?: unknown; expectedUpdatedAt?: Date | null },
): NotFound | NotAllowed | PreconditionFailed | undefined {
	if (access === "none") {
		if (opts?.expectedUpdatedAt instanceof Date) {
			return new PreconditionFailed(null);
		}
		return new NotFound(action.split(".")[0] ?? action);
	}
	if (rank(access) < rank(needed)) return new NotAllowed(action, opts);
}

/**
 * Throws what {@link accessError} returns.
 *
 * @throws {@link NotFound} If `access` is `none`.
 * @throws {@link PreconditionFailed} If `access` is `none` and `opts.expectedUpdatedAt` is a `Date`.
 * @throws {@link NotAllowed} If `access` is below `needed`.
 */
export function requireAccess(
	access: Access,
	needed: "read" | "write",
	action: ActionCode,
	opts?: { target?: unknown; expectedUpdatedAt?: Date | null },
): void {
	const error = accessError(access, needed, action, opts);
	if (error) throw error;
}

/**
 * How much of a question `actor` gets, from its status and whether an exam pins it.
 *
 * `write` is the whole document and goes to whoever writes the course's
 * contents; `read` is the public half.
 */
export function questionAccess(
	actor: Actor,
	row: { status: QuestionStatus; course: CourseWithEnrollment },
	pinned: boolean,
): Access {
	switch (
		visibility(row.status, {
			author: hasPerm(actor, "course.update-contents", row.course),
			member: hasPerm(actor, "course.read-contents", row.course),
			pinned,
		})
	) {
		case "full":
			return "write";
		case "public":
			return "read";
		case "absent":
			return "none";
		case "refused":
			return "see";
	}
}

/**
 * How much of an exam `actor` gets.
 *
 * Whoever writes the course's contents writes. Anyone else outside the
 * course only `see`s it, drafts included, so the refusal does not depend on
 * the status. A member reads it, unless it is a draft or archived.
 */
export function examAccess(
	actor: Actor,
	row: { status: Exam["status"]; course: CourseWithEnrollment },
): Access {
	if (hasPerm(actor, "course.update-contents", row.course)) return "write";
	if (!hasPerm(actor, "course.read-contents", row.course)) return "see";
	return hiddenFromStudents(row.status) ? "none" : "read";
}

/** How much of a response `actor` gets: the instructor writes, the author reads. */
export function responseAccess(actor: Actor, row: ResponseWithCourse): Access {
	return maxAccess(
		hasPerm(actor, "response.read", row) ? "read" : "none",
		hasPerm(actor, "response.update", row) ? "write" : "none",
	);
}
