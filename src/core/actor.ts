import type { User } from "@/db/services/user.service";

/**
 * A stripped down version of the User type with only the essential fields 
 * needed for authorization checks. 
 * 
 * This is used to avoid passing around the full User object when only a few 
 * fields are needed.
 */
export interface UserActor extends Pick<User, "id" | "role" | "username" | "name"> { }

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
