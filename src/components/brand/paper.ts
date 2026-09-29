/// Geometry of the Codehood brand: the logo pieces and the primitives that motifs
/// and illustrations are built from. Every helper returns an SVG path string;
/// sizes follow the logo, where one o has radius 12.

export type Part = { d: string; fill: string; rot?: number; glow?: boolean };

export const circle = (cx: number, cy: number, r: number) =>
	`M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;

export const rect = (x: number, y: number, w: number, h: number) =>
	`M${x} ${y}h${w}v${h}h${-w}Z`;

export const poly = (...xy: number[]) => {
	const pts: string[] = [];
	for (let i = 0; i < xy.length; i += 2) pts.push(`${xy[i]} ${xy[i + 1]}`);
	return `M${pts.join("L")}Z`;
};

/// The C: a bar with a round left end, 27k wide and 36k tall.
export const C = (x: number, y: number, k = 1) =>
	`M${x + 18 * k} ${y}h${9 * k}v${36 * k}h${-9 * k}A${18 * k} ${18 * k} 0 0 1 ${x + 18 * k} ${y}Z`;

/// An o: a disc of radius 12k centered on (cx, cy).
export const O = (cx: number, cy: number, k = 1) => circle(cx, cy, 12 * k);

/// The D: a bar with a round right end, 18k wide and 24k tall.
export const D = (x: number, y: number, k = 1) =>
	`M${x} ${y}h${6 * k}A${12 * k} ${12 * k} 0 0 1 ${x + 6 * k} ${y + 24 * k}h${-6 * k}Z`;

/// The e as a staircase stepping down to the right, 24k square.
export const S = (x: number, y: number, k = 1) =>
	poly(
		x,
		y,
		x + 8 * k,
		y,
		x + 8 * k,
		y + 8 * k,
		x + 16 * k,
		y + 8 * k,
		x + 16 * k,
		y + 16 * k,
		x + 24 * k,
		y + 16 * k,
		x + 24 * k,
		y + 24 * k,
		x,
		y + 24 * k,
	);

/// The H: a block 24k wide and 32k tall with a notch on top and a gap below.
export const H = (x: number, y: number, k = 1) =>
	`M${x} ${y}v${32 * k}h${8 * k}v${-16 * k}h${8 * k}v${16 * k}h${8 * k}v${-32 * k}h${-8 * k}v${8 * k}h${-8 * k}v${-8 * k}Z`;

/// The wall of a house: the H's lower gap becomes the door. Top-left at (x, y).
export const wall = (x: number, y: number, k = 1) =>
	`M${x} ${y + 10 * k}H${x + 24 * k}V${y + 32 * k}H${x + 15 * k}V${y + 22 * k}H${x + 9 * k}V${y + 32 * k}H${x}Z`;

/// The roof sitting on `wall(x, y, k)`.
export const roof = (x: number, y: number, k = 1) =>
	poly(x - 3 * k, y + 11 * k, x + 12 * k, y - 2 * k, x + 27 * k, y + 11 * k);

/// A four-pointed sparkle centered on (cx, cy).
export const star = (cx: number, cy: number, r: number) =>
	`M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;

/// Tilts every piece a few degrees, as if glued by hand. Deterministic so the
/// drawing looks the same on every render.
export const glue = (parts: Part[]): Part[] =>
	parts.map((p, i) => ({ ...p, rot: (((i * 37) % 7) - 3) * 0.8 }));

export const pieceStyle = (p: Part) =>
	p.rot ? `transform:rotate(${p.rot}deg)` : undefined;

/// Points along a quadratic curve, for bulbs hanging on a string.
export const along = (
	x0: number,
	y0: number,
	cx: number,
	cy: number,
	x1: number,
	y1: number,
	n: number,
) =>
	Array.from({ length: n }, (_, i) => {
		const t = (i + 0.5) / n;
		const u = 1 - t;
		return [
			u * u * x0 + 2 * u * t * cx + t * t * x1,
			u * u * y0 + 2 * u * t * cy + t * t * y1,
		] as const;
	});

/// Half-disc whose curved side faces up; the flat side sits at `cy`.
export const halfU = (cx: number, cy: number, rx: number, ry = rx) =>
	`M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}Z`;

/// Half-disc whose curved side faces down; the flat side sits at `cy`.
export const halfD = (cx: number, cy: number, rx: number, ry = rx) =>
	`M${cx - rx} ${cy}A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}Z`;

/// Quarter disc centered on the corner (cx, cy), filling the quadrant below and to the right.
export const quarter = (cx: number, cy: number, r: number) =>
	`M${cx} ${cy}H${cx + r}A${r} ${r} 0 0 1 ${cx} ${cy + r}Z`;

/// Rectangle with a semicircular top, like a door or a person's shoulders.
export const arch = (x: number, y: number, w: number, h: number) =>
	`M${x} ${y + h}V${y + w / 2}A${w / 2} ${w / 2} 0 0 1 ${x + w} ${y + w / 2}V${y + h}Z`;

/// Half-disc whose curved side faces left; the flat side sits at `cx`.
export const halfL = (cx: number, cy: number, r: number) =>
	`M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}Z`;

/// Half-disc whose curved side faces right; the flat side sits at `cx`.
export const halfR = (cx: number, cy: number, r: number) =>
	`M${cx} ${cy - r}A${r} ${r} 0 0 1 ${cx} ${cy + r}Z`;

/// Athos Bulcão-style figures for a 30-unit tile whose top-left corner is (x, y).
export const tileDesigns = [
	(x: number, y: number) => halfU(x + 15, y + 30, 12),
	(x: number, y: number) => quarter(x, y, 20),
	(x: number, y: number) => circle(x + 15, y + 15, 8),
	(x: number, y: number) => rect(x, y + 12, 30, 6),
	(x: number, y: number) => halfR(x, y + 15, 8) + halfL(x + 30, y + 15, 8),
	(x: number, y: number) => halfD(x + 15, y, 15, 10),
];

/// A 2×2 block of tiles derived from `code`, so the same course always gets the same block.
export const courseTile = (
	code: string,
	figures: string[],
	grounds: string[],
) => {
	let h = 7;
	for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 100003;
	return [0, 1, 2, 3].map((i) => {
		const x = (i % 2) * 30;
		const y = Math.floor(i / 2) * 30;
		const k = Math.floor(h / 7 ** i);
		const design = tileDesigns[k % tileDesigns.length] ?? tileDesigns[0];
		return {
			ground: rect(x, y, 30, 30),
			figure: design?.(x, y) ?? "",
			groundFill: grounds[i % grounds.length] ?? "#fff",
			figureFill: figures[(k >> 2) % figures.length] ?? "#000",
			rotate: ((k >> 4) % 4) * 90,
		};
	});
};

/// A straight bar of width `w` from one point to another.
export const seg = (
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	w: number,
) => {
	const len = Math.hypot(x1 - x0, y1 - y0);
	const nx = (-(y1 - y0) / len) * (w / 2);
	const ny = ((x1 - x0) / len) * (w / 2);
	return poly(
		x0 + nx,
		y0 + ny,
		x1 + nx,
		y1 + ny,
		x1 - nx,
		y1 - ny,
		x0 - nx,
		y0 - ny,
	);
};

/// A thin band along a quadratic curve, for the wire of a string of lights.
export const band = (
	x0: number,
	y0: number,
	cx: number,
	cy: number,
	x1: number,
	y1: number,
	t: number,
) => {
	const top = [
		[x0, y0] as const,
		...along(x0, y0, cx, cy, x1, y1, 40),
		[x1, y1] as const,
	];
	return poly(
		...top.flat(),
		...[...top].reverse().flatMap(([x, y]) => [x, y + t]),
	);
};

/// Pieces of the logo, in drawing order. The house replaces the H of the
/// original mark; its window is the only piece that never blends.
export type LogoPiece =
	| "c"
	| "o1"
	| "d1"
	| "e"
	| "wall"
	| "roof"
	| "window"
	| "o2"
	| "o3"
	| "d2";

export const LOGO: { piece: LogoPiece; d: string }[] = [
	{ piece: "c", d: C(6.65, 12.12) },
	{ piece: "o1", d: O(33.65, 30.12) },
	{ piece: "d1", d: D(45.65, 18.12) },
	{ piece: "e", d: S(57.65, 30.12) },
	{ piece: "wall", d: wall(69.65, 10.12) },
	{ piece: "roof", d: roof(69.65, 10.12) },
	{ piece: "window", d: rect(73.15, 23.12, 5, 5) },
	{ piece: "o2", d: O(101.65, 18.12) },
	{ piece: "o3", d: O(113.65, 30.12) },
	{ piece: "d2", d: D(119.65, 6.12) },
];

/// The default flanks: two pairs of squares, one on each side.
export const LOGO_SQUARES: string[] = [
	rect(-14.1, 18.25, 12, 12),
	rect(-2.1, 6.25, 12, 12),
	rect(129.9, 42.25, 12, 12),
	rect(141.9, 30.25, 12, 12),
];

/// The compact mark for favicons and app icons: the C, the o and the house.
export const MARK: { piece: LogoPiece; d: string }[] = [
	{ piece: "c", d: C(0, 0) },
	{ piece: "o1", d: O(27, 18) },
	{ piece: "wall", d: wall(43, 4) },
	{ piece: "roof", d: roof(43, 4) },
	{ piece: "window", d: rect(46.5, 17, 5, 5) },
];

/// View boxes: the logo with flanks, the logo alone, and the compact mark.
export const LOGO_BOX = {
	full: "-18 2 176 56",
	core: "3 3 138 54",
	mark: "-3 -4 76 76",
} as const;
