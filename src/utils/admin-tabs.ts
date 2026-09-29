/// The admin section's tabs, in display order; shared by the header and the
/// breadcrumbs. `overview` is the section root.
export const ADMIN_TABS = [
	{ key: "overview", label: "Overview", href: "/admin" },
	{ key: "users", label: "Users", href: "/admin/users" },
	{ key: "courses", label: "Courses", href: "/admin/courses" },
	{ key: "disciplines", label: "Disciplines", href: "/admin/disciplines" },
	{ key: "editions", label: "Editions", href: "/admin/editions" },
] as const;
