import { expect, test } from "@playwright/test";
import {
	canCreateUser,
	canEditUser,
	canInvite,
	canManageApiKeys,
	canManageSessions,
	canManageUsers,
	canViewUser,
	isAtLeast,
	userVisibility,
} from "@/auth/permissions";
import { type Actor, SYSTEM } from "@/db/base-service";

const admin = { id: 1, role: "ADMIN" as const };
const instructor = { id: 2, role: "INSTRUCTOR" as const };
const student = { id: 3, role: "STUDENT" as const };

test("role hierarchy", () => {
	expect(isAtLeast(admin, "INSTRUCTOR")).toBe(true);
	expect(isAtLeast(student, "INSTRUCTOR")).toBe(false);
});

test("invite permissions follow admin -> instructor -> student", () => {
	expect(canInvite(admin, "INSTRUCTOR")).toBe(true);
	expect(canInvite(admin, "STUDENT")).toBe(true);
	expect(canInvite(instructor, "STUDENT")).toBe(true);
	expect(canInvite(instructor, "INSTRUCTOR")).toBe(false);
	expect(canInvite(student, "STUDENT")).toBe(false);
});

test("api key ownership: owner or admin", () => {
	expect(canManageApiKeys(instructor, instructor.id)).toBe(true);
	expect(canManageApiKeys(instructor, 999)).toBe(false);
	expect(canManageApiKeys(admin, 999)).toBe(true);
});

test("session ownership: owner or admin", () => {
	expect(canManageSessions(instructor, instructor.id)).toBe(true);
	expect(canManageSessions(instructor, 999)).toBe(false);
	expect(canManageSessions(admin, 999)).toBe(true);
});

test("only admins manage users", () => {
	expect(canManageUsers(admin)).toBe(true);
	expect(canManageUsers(instructor)).toBe(false);
});

test("only the system creates user accounts directly", () => {
	expect(canCreateUser(SYSTEM)).toBe(true);
	expect(canCreateUser(admin)).toBe(false);
});

test("users edit only their own profile", () => {
	expect(canEditUser(student, student.id)).toBe(true);
	expect(canEditUser(student, 999)).toBe(false);
	expect(canEditUser(SYSTEM, 999)).toBe(true);
});

test("canViewUser and userVisibility agree: self and admins see everyone, others see only themselves", () => {
	const fixtures = [admin, instructor, student];
	const actors: Actor[] = [admin, instructor, student, SYSTEM];

	for (const actor of actors) {
		const visible = fixtures.filter((u) => canViewUser(actor, u));
		const expected =
			actor === SYSTEM || actor.role === "ADMIN"
				? fixtures
				: fixtures.filter((u) => u.id === actor.id);
		expect(visible).toEqual(expected);

		// The Prisma fragment must accept exactly the same rows the predicate does.
		const fragment = userVisibility(actor);
		if (actor === SYSTEM || actor.role === "ADMIN") {
			expect(fragment).toEqual({});
		} else {
			expect(fragment).toEqual({ id: actor.id });
		}
	}
});

test("SYSTEM bypasses every rule", () => {
	expect(isAtLeast(SYSTEM, "ADMIN")).toBe(true);
	expect(canInvite(SYSTEM, "INSTRUCTOR")).toBe(true);
	expect(canManageApiKeys(SYSTEM, 999)).toBe(true);
	expect(canManageSessions(SYSTEM, 999)).toBe(true);
	expect(canManageUsers(SYSTEM)).toBe(true);
	expect(canViewUser(SYSTEM, { id: 999 })).toBe(true);
});
