import { circle, type Part, poly } from "./paper";

/// Ipê in bloom: round clusters of trumpet flowers, one color per variant,
/// following Brasília's dry season (see docs/ui/identity.md).

/// One trumpet flower pointing away from (cx, cy): a narrow tube that flares
/// into a round mouth of radius `m` at distance `len`.
export const trumpet = (
	cx: number,
	cy: number,
	a: number,
	len: number,
	m: number,
) => {
	const ex = cx + Math.cos(a) * len;
	const ey = cy + Math.sin(a) * len;
	const px = -Math.sin(a);
	const py = Math.cos(a);
	return {
		body:
			poly(
				cx + px * 0.5,
				cy + py * 0.5,
				ex + px * m * 0.8,
				ey + py * m * 0.8,
				ex - px * m * 0.8,
				ey - py * m * 0.8,
				cx - px * 0.5,
				cy - py * 0.5,
			) + circle(ex, ey, m),
		throat: circle(ex, ey, m * 0.38),
	};
};

/// A round cluster of trumpets, as ipês bloom, in two shades with contrasting throats.
export const cluster = (
	cx: number,
	cy: number,
	r: number,
	c: { base: string; light: string; throat: string },
): Part[] => {
	const flowers = Array.from({ length: 8 }, (_, i) =>
		trumpet(cx, cy, (i * Math.PI) / 4 + r, r * 0.62, r * 0.36),
	);
	return [
		{ d: circle(cx, cy, r * 0.4), fill: c.base },
		{
			d: flowers
				.filter((_, i) => i % 2 === 0)
				.map((f) => f.body)
				.join(""),
			fill: c.base,
		},
		{
			d: flowers
				.filter((_, i) => i % 2 === 1)
				.map((f) => f.body)
				.join(""),
			fill: c.light,
		},
		{ d: flowers.map((f) => f.throat).join(""), fill: c.throat },
	];
};

export type Ipe = "purple" | "pink" | "yellow" | "white";

export const IPES: Record<
	Ipe,
	{ name: string; window: string; base: string; light: string; throat: string }
> = {
	purple: {
		name: "Purple ipê",
		window: "June 1 to July 15",
		base: "#a8309a",
		light: "#c952b6",
		throat: "#f2c230",
	},
	pink: {
		name: "Pink ipê",
		window: "July 16 to August 5",
		base: "#e04f94",
		light: "#f47fb4",
		throat: "#f7d046",
	},
	yellow: {
		name: "Yellow ipê",
		window: "August 6 to September 5",
		base: "#f2b800",
		light: "#ffd24a",
		throat: "#b5452a",
	},
	white: {
		name: "White ipê",
		window: "September 6 to 30",
		base: "#e6e0d4",
		light: "#ffffff",
		throat: "#f2c230",
	},
};

/// Which ipê is in bloom in Brasília on `date`, or null outside the flowering.
/// The windows are approximate and shift every year with the rains.
export const ipeInBloom = (date: Date): Ipe | null => {
	const md = (date.getMonth() + 1) * 100 + date.getDate();
	if (md >= 601 && md <= 715) return "purple";
	if (md >= 716 && md <= 805) return "pink";
	if (md >= 806 && md <= 905) return "yellow";
	if (md >= 906 && md <= 930) return "white";
	return null;
};
