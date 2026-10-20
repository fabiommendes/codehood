import { m } from "@/i18n";

/// Human labels for a user's role, as menus and badges show it.
export const roleLabels = {
	STUDENT: m.nav_role_student(),
	INSTRUCTOR: m.nav_role_instructor(),
	ADMIN: m.nav_role_admin(),
} as const;
