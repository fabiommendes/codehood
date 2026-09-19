import type { Role } from "@/db/client";
import type { User } from "@/db/services/user.service";

// Consumers must read role from here, not prisma client.
export type { Role } from "@/db/client";

const ROLE_RANK: Record<Role, number> = {
	STUDENT: 0,
	INSTRUCTOR: 1,
	ADMIN: 2,
};

/**
 * A stripped down version of the User type with only the essential fields
 * needed for authorization checks.
 *
 * This is used to avoid passing around the full User object when only a few
 * fields are needed.
 */
export interface UserActor extends Pick<User, "role" | "username" | "name"> {}

/**
 * Sentinel actor for callers with no user behind them.
 *
 * Used on seeds, manage commands, etc.
 *
 * A symbol so it can never arrive by accident from parsed JSON or a
 * forgotten variable — writing `SYSTEM` is a decision you can see in a diff.
 */
export const SYSTEM = Symbol("system");

/**
 * The actor abstracts the entity performing an action, which may be a user or
 * the system itself.
 *
 * This allows for consistent permission checks and auditing across the
 * application.
 */
export type Actor = UserActor | typeof SYSTEM;

/**
 * Shorthand for `{ actor: SYSTEM }`, for trusted call sites with no transaction.
 */
export const FULL_ACCESS = Object.freeze({ actor: SYSTEM } as const);

/**
 * True if `actor` has at least the given `role`. SYSTEM is the highest role.
 */
export function hasMinimumRole(actor: Actor, role: Role): boolean {
	if (actor === SYSTEM) return true;
	return ROLE_RANK[actor.role] >= ROLE_RANK[role];
}
