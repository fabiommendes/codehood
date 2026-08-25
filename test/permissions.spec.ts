import { expect, test } from "@playwright/test";
import {
	canInvite,
	canManageApiKeys,
	canManageUsers,
	isAtLeast,
} from "@/auth/permissions";

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

test("only admins manage users", () => {
	expect(canManageUsers(admin)).toBe(true);
	expect(canManageUsers(instructor)).toBe(false);
});
