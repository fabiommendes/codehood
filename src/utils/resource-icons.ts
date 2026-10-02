/// SVG path of each resource type's icon, drawn on a 24×24 stroke grid.
export const RESOURCE_ICONS = {
	FILE: "M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z M14 3.5V8h4",
	LINK: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
	MD: "M6 3.5h9l3 3V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z M8 12h8M8 15.5h8M8 8.5h4",
	CODE: "m9 8-4 4 4 4M15 8l4 4-4 4M13.5 6.5l-3 11",
} as const;

/// What a click on a row does, for the rows that leave the page: a download, or another tab.
export const RESOURCE_ACTION_ICONS: Partial<
	Record<keyof typeof RESOURCE_ICONS, string>
> = {
	FILE: "M12 4v11m0 0 4-4m-4 4-4-4M5 19h14",
	LINK: "M14 4h6v6 M20 4l-9 9 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};
