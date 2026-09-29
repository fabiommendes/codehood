/**
 * Writes the static brand files in public/ from the geometry in
 * src/components/brand/paper.ts: logo.svg, favicon.svg, favicon.png and
 * favicon.ico. PNG and ICO need `rsvg-convert` and ImageMagick (`magick`).
 *
 * Run with `pnpm run brand` after changing the logo geometry or its colors.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	LOGO,
	LOGO_BOX,
	LOGO_SQUARES,
	type LogoPiece,
	MARK,
} from "../src/components/brand/paper";

const PUBLIC = path.resolve(import.meta.dirname, "../public");

/// Piece colors, mirroring the --lp-* variables in src/styles/global.css.
const LIGHT: Record<LogoPiece | "pixel", string> = {
	c: "#1b4b9b",
	o1: "#b5452a",
	d1: "#f2b800",
	e: "#3c8d2f",
	wall: "#1b4b9b",
	roof: "#b5452a",
	window: "#f2b800",
	o2: "#b5452a",
	o3: "#3c8d2f",
	d2: "#f2b800",
	pixel: "#ddd6c6",
};

/// Dark tone steps, used at small sizes on dark grounds.
const DARK_SMALL: Record<LogoPiece | "pixel", string> = {
	c: "#ffffff",
	o1: "#7d948a",
	d1: "#c3d0ca",
	e: "#52695f",
	wall: "#ffffff",
	roof: "#7d948a",
	window: "#ffc400",
	o2: "#7d948a",
	o3: "#ffffff",
	d2: "#7d948a",
	pixel: "#2c5244",
};

const outline = (pieces: typeof MARK, color: string) =>
	`<g opacity="0.5" fill="${color}" stroke="${color}" stroke-width="3" stroke-linejoin="round">${pieces
		.map((p) => `<path d="${p.d}"/>`)
		.join("")}</g>`;

const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_BOX.full}" width="352" height="112">
<g>
${LOGO_SQUARES.map((d) => `<path fill="${LIGHT.pixel}" d="${d}"/>`).join("\n")}
${LOGO.map((p) => `<path fill="${LIGHT[p.piece]}" d="${p.d}"${p.piece === "window" ? "" : ' style="mix-blend-mode:multiply"'}/>`).join("\n")}
</g>
</svg>
`;

/// The favicon follows the browser's color scheme: Cerrado colors on light
/// tabs, tone steps with a light outline on dark ones.
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_BOX.mark}">
<style>
${MARK.map((p) => `.${p.piece}{fill:${LIGHT[p.piece]}}`).join("")}
.line{display:none}
@media (prefers-color-scheme: dark){${MARK.map((p) => `.${p.piece}{fill:${DARK_SMALL[p.piece]}}`).join("")}.line{display:inline;fill:#fff;stroke:#fff}}
</style>
<g class="line" opacity="0.5" stroke-width="3" stroke-linejoin="round">${MARK.map((p) => `<path d="${p.d}"/>`).join("")}</g>
${MARK.map((p) => `<path class="${p.piece}" d="${p.d}"/>`).join("\n")}
</svg>
`;

/// Raster icons can't follow the color scheme, so they sit on a Forest tile.
const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -13 94 94">
<rect x="-12" y="-13" width="94" height="94" rx="20" fill="#0d211a"/>
${outline(MARK, "#ffffff")}
${MARK.map((p) => `<path fill="${DARK_SMALL[p.piece]}" d="${p.d}"/>`).join("\n")}
</svg>
`;

writeFileSync(path.join(PUBLIC, "logo.svg"), logoSvg);
writeFileSync(path.join(PUBLIC, "favicon.svg"), faviconSvg);

const tmp = mkdtempSync(path.join(tmpdir(), "codehood-brand-"));
const tile = path.join(tmp, "tile.svg");
writeFileSync(tile, tileSvg);
execFileSync(
	"rsvg-convert",
	["-w", "1024", "-h", "1024", tile, "-o", path.join(PUBLIC, "favicon.png")],
	{ timeout: 30_000 },
);
execFileSync(
	"magick",
	[
		path.join(PUBLIC, "favicon.png"),
		"-define",
		"icon:auto-resize=256,128,64,48,32,24,16",
		path.join(PUBLIC, "favicon.ico"),
	],
	{ timeout: 30_000 },
);

console.log("wrote public/logo.svg, favicon.svg, favicon.png, favicon.ico");
