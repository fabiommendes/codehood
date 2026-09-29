/// Two-tone icons on a 24-unit grid, built from the same pieces as the logo.
/// Each takes its colors as arguments, so callers decide how they follow the theme.

import { arch, circle, type Part, poly, rect, roof, seg, wall } from "./paper";

/// A five-petal flower centered on (cx, cy).
export const flower = (cx: number, cy: number, r: number) =>
	[0, 1, 2, 3, 4]
		.map((i) => {
			const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
			return circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.75);
		})
		.join("");

/// Icons on a 24-unit grid, in two tones: `ink` for the body, `accent` for the detail.
export const ICONS: {
	name: string;
	parts: (ink: string, accent: string, paper: string) => Part[];
}[] = [
	{
		name: "Home",
		parts: (ink, accent) => [
			{ d: wall(4.5, 2.5, 0.62), fill: ink },
			{ d: roof(4.5, 2.5, 0.62), fill: ink },
			{ d: rect(6.5, 10.6, 3.2, 3.2), fill: accent },
		],
	},
	{
		name: "Courses",
		parts: (ink, accent) => [
			{ d: rect(2, 5, 20, 11), fill: ink },
			...[5, 11, 17].map((x) => ({ d: rect(x, 16, 2, 5), fill: ink })),
			...[6, 10, 14, 18].map((x) => ({
				d: circle(x, 10.5, 1.5),
				fill: accent,
			})),
		],
	},
	{
		name: "Exams",
		parts: (ink, accent, paper) => [
			{ d: rect(5, 2, 14, 20), fill: ink },
			{ d: circle(12, 9, 3.5), fill: accent },
			{ d: rect(8, 15, 8, 1.8), fill: paper },
			{ d: rect(8, 18, 5, 1.8), fill: paper },
		],
	},
	{
		name: "Calendar",
		parts: (ink, accent, paper) => [
			{ d: rect(3, 4, 18, 17), fill: ink },
			...[
				[6, 9],
				[11, 9],
				[16, 9],
				[6, 14],
				[16, 14],
			].map(([x = 0, y = 0]) => ({ d: rect(x, y, 3, 3), fill: paper })),
			{ d: rect(11, 14, 3, 3), fill: accent },
		],
	},
	{
		name: "Resources",
		parts: (ink, accent) => [
			{ d: rect(3, 9, 14, 12), fill: ink },
			{ d: rect(7, 4, 14, 12), fill: accent },
		],
	},
	{
		name: "Questions",
		parts: (ink, accent) => [
			{ d: circle(12, 10.5, 8.5), fill: ink },
			{ d: poly(6, 16, 4, 22, 11, 18), fill: ink },
			{ d: circle(12, 10.5, 3), fill: accent },
		],
	},
	{
		name: "Students",
		parts: (ink, accent) => [
			{ d: circle(15.5, 6, 3), fill: accent },
			{ d: arch(10.5, 10, 10, 11), fill: accent },
			{ d: circle(8.5, 8, 3.2), fill: ink },
			{ d: arch(3, 12.5, 11, 9.5), fill: ink },
		],
	},
	{
		name: "Grades released",
		parts: (ink, accent) => [
			{ d: flower(12, 12, 5), fill: accent },
			{ d: circle(12, 12, 3), fill: ink },
		],
	},
	{
		name: "Settings",
		parts: (ink, accent) => [
			{ d: circle(12, 12, 7), fill: ink },
			{ d: rect(10, 1.5, 4, 4), fill: ink },
			{ d: rect(10, 18.5, 4, 4), fill: ink },
			{ d: rect(1.5, 10, 4, 4), fill: ink },
			{ d: rect(18.5, 10, 4, 4), fill: ink },
			{ d: circle(12, 12, 3), fill: accent },
		],
	},
	{
		name: "Terminal",
		parts: (ink, accent, paper) => [
			{ d: rect(2, 4, 20, 16), fill: ink },
			{
				d: poly(5.5, 8.5, 10, 12, 5.5, 15.5, 5.5, 13.5, 7.5, 12, 5.5, 10.5),
				fill: paper,
			},
			{ d: rect(11.5, 13.5, 7, 2), fill: accent },
		],
	},
	{
		name: "Branch",
		parts: (ink, accent) => [
			{ d: seg(7, 5, 7, 19, 2.2), fill: ink },
			{ d: seg(17, 9, 7, 15.5, 2.2), fill: accent },
			{ d: circle(7, 5, 2.8) + circle(7, 19, 2.8), fill: ink },
			{ d: circle(17, 9, 2.8), fill: accent },
		],
	},
];
