/**
 * The links a course page hands to the course card in the sidebar, and the
 * pure step that marks where the reader is. No Astro, no Prisma import.
 */

/** A leaf of the card: a page, or a section of one when `href` has a hash. */
export interface NavLink {
	label: string;
	href: string;
	/// Short count or status shown at the end of the row.
	meta?: string | number;
}

/** A top-level row; its `children` fold under it, and go no deeper. */
export interface NavEntry extends NavLink {
	children?: NavLink[];
}

/** A run of entries under an optional plain label, which is not a level. */
export interface NavSection {
	label?: string;
	meta?: string | number;
	entries: NavEntry[];
}

/** What a page tells the course card beyond the course and tab in its URL. */
export interface CourseNav {
	/// The entity the page belongs to, shown under the tab (an exam's title).
	context?: string;
	sections: NavSection[];
}

/** A link resolved against the current URL. */
export interface MarkedLink extends NavLink {
	/// The page being shown.
	current: boolean;
	/// A section of the page being shown, marked as the reader scrolls.
	anchor: boolean;
}

export interface MarkedEntry extends MarkedLink {
	/// Unfolded: the entry is the current page or holds it.
	open: boolean;
	children: MarkedLink[];
}

export interface MarkedSection extends Omit<NavSection, "entries"> {
	entries: MarkedEntry[];
}

export interface MarkedNav extends Omit<CourseNav, "sections"> {
	sections: MarkedSection[];
	/// The entry the reader is on, for the mobile trail.
	current?: MarkedEntry;
}

/**
 * Marks which links of `nav` point at `url`, and turns links into the
 * current page into in-page anchors.
 *
 * The path must match, and so must every query parameter the link carries;
 * extra parameters in `url` are ignored and the hash only picks a section.
 * A builder can therefore hand the same `nav` to every page it covers.
 */
export function markCourseNav(nav: CourseNav, url: URL): MarkedNav {
	const path = (u: URL) => u.pathname.replace(/\/$/, "");
	const mark = (link: NavLink): MarkedLink => {
		const target = new URL(link.href, url);
		const samePage =
			path(target) === path(url) &&
			[...target.searchParams].every(
				([key, value]) => url.searchParams.get(key) === value,
			);
		const anchor = samePage && target.hash !== "";
		return {
			...link,
			href: anchor ? target.hash : link.href,
			current: samePage && !anchor,
			anchor,
		};
	};
	let current: MarkedEntry | undefined;
	const sections = nav.sections.map((section) => ({
		...section,
		entries: section.entries.map((entry) => {
			const children = (entry.children ?? []).map(mark);
			const self = mark(entry);
			const holds = children.some((c) => c.current || c.anchor);
			const marked: MarkedEntry = {
				...self,
				current: self.current || children.some((c) => c.current),
				open: children.length > 0 && (self.current || holds),
				children,
			};
			if (marked.current || holds) current ??= marked;
			return marked;
		}),
	}));
	return { ...nav, sections, current };
}
