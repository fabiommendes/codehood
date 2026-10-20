import { m } from "@/i18n";

/// The admin section's tabs, in display order; shared by the header and the
/// breadcrumbs. `overview` is the section root.
export const ADMIN_TABS = [
	{ key: "overview", label: m.nav_admin_tab_overview(), href: "/admin" },
	{ key: "users", label: m.nav_admin_tab_users(), href: "/admin/users" },
	{ key: "courses", label: m.nav_courses(), href: "/admin/courses" },
	{
		key: "disciplines",
		label: m.nav_admin_tab_disciplines(),
		href: "/admin/disciplines",
	},
	{
		key: "editions",
		label: m.nav_admin_tab_editions(),
		href: "/admin/editions",
	},
] as const;
