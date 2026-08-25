import type { Role } from "@/db/client";

export interface AuthUser {
	id: number;
	role: Role;
}

const ROLE_RANK: Record<Role, number> = {
	STUDENT: 0,
	INSTRUCTOR: 1,
	ADMIN: 2,
};

export function isAtLeast(user: AuthUser, role: Role): boolean {
	return ROLE_RANK[user.role] >= ROLE_RANK[role];
}

/** Whether `actor` is allowed to create an invite for `targetRole`. */
export function canInvite(actor: AuthUser, targetRole: Role): boolean {
	if (actor.role === "ADMIN")
		return targetRole === "INSTRUCTOR" || targetRole === "STUDENT";
	if (actor.role === "INSTRUCTOR") return targetRole === "STUDENT";
	return false;
}

/** Whether `actor` may issue/revoke API keys belonging to `ownerId`. */
export function canManageApiKeys(actor: AuthUser, ownerId: number): boolean {
	return actor.id === ownerId || actor.role === "ADMIN";
}

export function canManageUsers(actor: AuthUser): boolean {
	return actor.role === "ADMIN";
}
