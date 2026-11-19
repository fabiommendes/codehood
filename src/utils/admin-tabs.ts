import { m } from "@/i18n";
import { urls } from "@/urls";

/// The admin section's tabs, in display order; shared by the header and the
/// breadcrumbs. `overview` is the section root.
export const ADMIN_TABS = [
	{
		key: "overview",
		label: m.nav_admin_tab_overview(),
		href: urls.admin.index(),
	},
	{ key: "users", label: m.nav_admin_tab_users(), href: urls.admin.users() },
	{ key: "courses", label: m.nav_courses(), href: urls.admin.courses() },
	{
		key: "disciplines",
		label: m.nav_admin_tab_disciplines(),
		href: urls.admin.disciplines(),
	},
	{
		key: "editions",
		label: m.nav_admin_tab_editions(),
		href: urls.admin.editions(),
	},
	{
		key: "reports",
		label: m.nav_admin_tab_reports(),
		href: urls.admin.reports(),
	},
] as const;
