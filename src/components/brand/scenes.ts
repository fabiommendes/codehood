import { m } from "@/i18n";
import {
	arch,
	band,
	circle,
	type Part,
	rect,
	roof,
	seg,
	star,
	wall,
} from "./paper";

/// Illustrations: night scenes built from the logo's pieces. They are drawn on
/// a dark panel in both themes, and parts marked `glow` are light sources.

/// Night palette of the illustrations, from the contrast study.
export const NIGHT = {
	ground: "#0d211a",
	slab: "#1c3b31",
	white: "#f7faf8",
	gray1: "#a9bab2",
	gray2: "#6f8a7e",
	amber: "#ffc400",
	magenta: "#ff2d87",
	lime: "#b5f000",
	azure: "#1f8bff",
	cyan: "#00d2e6",
	red: "#ff5c5c",
};

/// A short dashed segment from (ax, ay) to (bx, by), in `n` dashes.
const dashed = (ax: number, ay: number, bx: number, by: number, n: number) =>
	Array.from({ length: n }, (_, i) => {
		const t0 = i / n;
		const t1 = (i + 0.55) / n;
		return seg(
			ax + (bx - ax) * t0,
			ay + (by - ay) * t0,
			ax + (bx - ax) * t1,
			ay + (by - ay) * t1,
			3,
		);
	}).join("");

/// A binary tree whose canopy is a tree of nodes; the leaves are lit. With
/// `missing`, that node is an empty ring at the end of a dashed edge.
const tree = (missing?: number) => {
	const nodes: [number, number][] = [
		[180, 140],
		[124, 100],
		[236, 100],
		[92, 58],
		[152, 58],
		[208, 58],
		[268, 58],
	];
	const edges = [
		[0, 1],
		[0, 2],
		[1, 3],
		[1, 4],
		[2, 5],
		[2, 6],
	];
	const fills = [
		NIGHT.white,
		NIGHT.gray1,
		NIGHT.gray1,
		NIGHT.amber,
		NIGHT.lime,
		NIGHT.cyan,
		NIGHT.magenta,
	];
	const at = (i: number) => nodes[i] ?? [0, 0];
	return [
		...[
			[40, 30, 3],
			[320, 34, 3.5],
			[60, 110, 2],
			[300, 120, 2],
		].map(([x = 0, y = 0, r = 2]) => ({
			d: star(x, y, r),
			fill: NIGHT.white,
			glow: true,
		})),
		{ d: rect(0, 186, 360, 14), fill: "#0a1a14" },
		{ d: rect(176, 140, 8, 48), fill: "#2c5244" },
		...edges.map(([a = 0, b = 0]) => ({
			d:
				b === missing
					? dashed(...at(a), ...at(b), 4)
					: seg(...at(a), ...at(b), 3),
			fill: "#2c5244",
		})),
		...nodes.flatMap(([x, y], i): Part[] =>
			i === missing
				? [
						{ d: circle(x, y, 12), fill: NIGHT.gray2 },
						{ d: circle(x, y, 9.5), fill: NIGHT.ground },
					]
				: [
						{
							d: circle(x, y, i === 0 ? 14 : 12),
							fill: fills[i] ?? NIGHT.white,
							glow: i >= 3,
						},
					],
		),
		...[
			[40, 170, 1.6],
			[120, 160, 1.9],
			[250, 176, 1.4],
			[330, 164, 1.7],
		].map(([x = 0, y = 0, r = 1]) => ({
			d: circle(x, y, r),
			fill: NIGHT.lime,
			glow: true,
		})),
	] as Part[];
};

/// A line of code on the monitor: indent, length and color.
type CodeLine = [indent: number, length: number, fill: string];

const CODE: CodeLine[] = [
	[0, 60, NIGHT.azure],
	[12, 84, NIGHT.magenta],
	[12, 50, NIGHT.amber],
	[24, 70, NIGHT.lime],
	[12, 40, NIGHT.cyan],
	[0, 30, NIGHT.azure],
];

/// A program that stopped: dimmed lines, then one long red one.
const CRASH: CodeLine[] = [
	[0, 60, NIGHT.gray2],
	[12, 84, NIGHT.gray2],
	[12, 50, NIGHT.gray2],
	[24, 118, NIGHT.red],
];

/// Someone coding late at night, seen from behind, with the moon at the window.
const desk = (lines: CodeLine[]): Part[] => [
	{ d: rect(24, 20, 70, 56), fill: "#15302a" },
	{ d: circle(58, 46, 12), fill: NIGHT.white, glow: true },
	{ d: circle(64, 42, 11), fill: "#15302a" },
	{ d: star(38, 30, 2), fill: NIGHT.white, glow: true },
	{ d: star(82, 64, 1.8), fill: NIGHT.white, glow: true },
	{ d: rect(0, 160, 360, 40), fill: NIGHT.slab },
	{ d: rect(150, 40, 170, 104), fill: NIGHT.slab },
	{ d: rect(158, 48, 154, 88), fill: "#081510" },
	...lines.map(([indent, len, fill], i) => ({
		d: rect(166 + indent, 56 + i * 11, len, 5),
		fill,
		glow: fill !== NIGHT.gray2,
	})),
	{
		d: rect(166, 56 + lines.length * 11 + 1, 5, 7),
		fill: NIGHT.white,
		glow: true,
	},
	{ d: rect(228, 144, 14, 12), fill: "#2c5244" },
	{ d: rect(210, 154, 50, 6), fill: "#2c5244" },
	{ d: rect(56, 136, 16, 24), fill: NIGHT.gray1 },
	{ d: arch(92, 126, 58, 40), fill: NIGHT.gray2 },
	{ d: circle(121, 112, 16), fill: NIGHT.gray1 },
];

/// A graph of stars over a few houses on a hill.
const constellation = (() => {
	const pts: [number, number][] = [
		[40, 40],
		[92, 24],
		[140, 58],
		[204, 30],
		[252, 64],
		[304, 28],
		[332, 84],
		[172, 96],
	];
	const edges = [
		[0, 1],
		[1, 2],
		[2, 3],
		[3, 4],
		[4, 5],
		[5, 6],
		[2, 7],
		[7, 4],
	];
	const at = (i: number) => pts[i] ?? [0, 0];
	const home = (x: number, base: number, k: number, fill: string): Part[] => {
		const y = base - 32 * k;
		return [
			{ d: wall(x, y, k), fill },
			{ d: roof(x, y, k), fill: NIGHT.gray1 },
			{
				d: rect(x + 3.5 * k, y + 13 * k, 5 * k, 5 * k),
				fill: NIGHT.amber,
				glow: true,
			},
		];
	};
	return [
		...edges.map(([a = 0, b = 0]) => ({
			d: seg(...at(a), ...at(b), 1),
			fill: "#3d5f52",
		})),
		...pts.map(([x, y], i) => ({
			d: star(x, y, i % 3 ? 4 : 5.5),
			fill: i === 4 ? NIGHT.amber : NIGHT.white,
			glow: true,
		})),
		{
			d: band(224, 124, 256, 114, 290, 104, 1.2),
			fill: NIGHT.white,
			glow: true,
		},
		{ d: star(290, 104, 3.5), fill: NIGHT.white, glow: true },
		{ d: "M-10 205Q180 120 370 205Z", fill: "#173a2f" },
		...home(118, 178, 0.8, NIGHT.gray2),
		...home(156, 168, 1, NIGHT.white),
		...home(198, 168, 0.9, NIGHT.gray1),
		...home(238, 178, 0.8, NIGHT.white),
	] as Part[];
})();

/// A house on the hill with its door shut and padlocked; the neighbors are lit.
const lockedHouse = (() => {
	const k = 2.6;
	const x = 180 - 12 * k;
	const y = 176 - 32 * k;
	const neighbor = (hx: number, base: number, hk: number): Part[] => {
		const hy = base - 32 * hk;
		return [
			{ d: wall(hx, hy, hk), fill: NIGHT.gray2 },
			{ d: roof(hx, hy, hk), fill: NIGHT.gray1 },
			{
				d: rect(hx + 3.5 * hk, hy + 13 * hk, 5 * hk, 5 * hk),
				fill: NIGHT.amber,
				glow: true,
			},
		];
	};
	return [
		...[
			[48, 36, 3],
			[300, 30, 3.5],
			[96, 70, 2],
			[262, 86, 2.2],
		].map(([sx = 0, sy = 0, r = 2]) => ({
			d: star(sx, sy, r),
			fill: NIGHT.white,
			glow: true,
		})),
		{ d: "M-10 205Q180 120 370 205Z", fill: "#173a2f" },
		...neighbor(76, 186, 1),
		...neighbor(262, 184, 1.1),
		{ d: wall(x, y, k), fill: NIGHT.white },
		{ d: roof(x, y, k), fill: NIGHT.gray1 },
		{ d: rect(x + 3 * k, y + 13 * k, 5 * k, 5 * k), fill: "#2c5244" },
		{ d: rect(x + 16 * k, y + 13 * k, 5 * k, 5 * k), fill: "#2c5244" },
		{ d: rect(x + 9 * k, y + 22 * k, 6 * k, 10 * k), fill: NIGHT.gray2 },
		{ d: arch(173, y + 20 * k, 14, 16), fill: NIGHT.amber },
		{ d: arch(176.5, y + 20 * k + 3.5, 7, 12), fill: NIGHT.gray2 },
		{ d: rect(170, y + 25 * k, 20, 15), fill: NIGHT.amber, glow: true },
		{ d: circle(180, y + 25 * k + 6, 2.2), fill: NIGHT.ground },
		{ d: rect(179, y + 25 * k + 7, 2, 5), fill: NIGHT.ground },
	] as Part[];
})();

/// Every illustration, with the caption that doubles as its accessible label.
export const SCENES = {
	binaryTree: {
		parts: tree(),
		caption: m.nav_scene_binary_tree(),
	},
	lateNight: { parts: desk(CODE), caption: m.nav_scene_late_night() },
	constellation: {
		parts: constellation,
		caption: m.nav_scene_constellation(),
	},
	missingLeaf: {
		parts: tree(6),
		caption: m.nav_scene_missing_leaf(),
	},
	lockedHouse: {
		parts: lockedHouse,
		caption: m.nav_scene_locked_house(),
	},
	crash: {
		parts: desk(CRASH),
		caption: m.nav_scene_crash(),
	},
} satisfies Record<string, { parts: Part[]; caption: string }>;

export type SceneName = keyof typeof SCENES;
