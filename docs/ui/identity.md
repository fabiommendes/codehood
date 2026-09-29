# Visual identity

Codehood looks hand-made: shapes cut from colored paper, glued slightly
askew, on a warm ground. Teaching and learning should feel welcoming, so the
site avoids the generic look of developer tools. How we got here is in
[briefing.md](briefing.md); the prototypes live under `/design/*` (listed at
the end).

The themes live in `src/styles/global.css`, the logo in
`src/components/Logo.astro`, and its geometry in `src/components/brand/paper.ts`.
`pnpm run brand` regenerates `public/logo.svg` and the favicons from that
geometry.


## Personality

Personality is strong at the edges and quiet where people work.

| Loud                                 | Quiet                          |
| :----------------------------------- | :----------------------------- |
| Landing page, login                  | Exam in progress               |
| Empty states, error pages            | Reading a resource or question |
| Released grades, first visit         | Grade tables, rosters, forms   |

Quiet screens drop tilt, tape and illustration, and keep the colors, type
and rounded paper shapes. The UX rules in `docs/ux/principles.md` apply on
top of this document.


## Logo

### Construction

The logo is the original Codehood mark rebuilt from paper. The word is
suggested by pieces, not spelled:

| Piece      | Shape                                        |
| :--------- | :------------------------------------------- |
| C          | Bar with a round left end                    |
| o          | Disc, overlapping the C                      |
| D          | Bar with a round right end                   |
| e          | Staircase of three steps                     |
| H          | A house: the H's lower gap is the door, a triangle is the roof, one lit window |
| o, o       | Two discs, stepped diagonally                |
| D          | Bar with a round right end, raised           |
| Flanks     | Two slots, one at each side (see below)      |

Geometry is in `src/components/brand/paper.ts` (`LOGO`, `LOGO_SQUARES`, `MARK`). In large sizes the pieces carry cut edges (an SVG displacement
filter) and a deterministic tilt of up to 2.4°.

### Colors

In the light theme the logo keeps its colors, taken from the Cerrado palette.
In the dark theme it is monochrome, with one warm accent: the lit window.

| Piece                     | Light (on Lime wash) | Dark (on Forest) |
| :------------------------ | :------------------- | :--------------- |
| C, house wall             | `#1b4b9b`            | `#f7faf8`        |
| First o, roof, middle o   | `#b5452a`            | `#a9bab2`, `#a9bab2`, `#f7faf8` |
| Both D                    | `#f2b800`            | `#6f8a7e`, `#a9bab2` |
| e, last o                 | `#3c8d2f`            | `#a9bab2`, `#6f8a7e` |
| Window                    | `#f2b800`            | `#ffc400`        |
| Flank squares             | `#ddd6c6`            | `#2c5244`        |

The exact per-piece values are the `--lp-*` variables in `global.css`. On
light grounds the pieces blend with multiply, like tissue paper, except the
window. On dark grounds they stack with a small shadow.

### Flanks

The core never changes. The two flank slots take a motif chosen by context,
always inside the same bounding box so the logo never changes width.

| Flank                  | Where                                           |
| :--------------------- | :---------------------------------------------- |
| Squares                | Default                                         |
| Party lights           | Celebrations: released grades, end of term. The string crosses the whole logo and is drawn over it. |
| Fireflies and a shooting star | Night: landing page and empty states in the dark theme |
| Athos tiles            | Tiled backgrounds, printed material             |
| Ipê in bloom           | Dry season, automatically (see below)           |

Flanks are dropped below 32 px of height.

### Ipê calendar

During Brasília's dry season the flanks show clusters of the ipê in bloom:
round, overlapping clusters of trumpet flowers, one color per variant, each
trumpet with a contrasting throat. The usual order is purple, pink, yellow,
white. The windows are approximate and change every year with the rains, so
they belong in configuration, not in code:

| Ipê    | Default window           |
| :----- | :----------------------- |
| Purple | June 1 to July 15        |
| Pink   | July 16 to August 5      |
| Yellow | August 6 to September 5  |
| White  | September 6 to 30        |

Outside these windows the flanks fall back to the squares.

### Small sizes

Below 32 px the logo loses cut edges, tilt and flanks. In the dark theme a
white 1.5 px outline at 50% opacity goes around the whole drawing, never around
each piece, and the pieces switch to tone steps, so neighboring pieces sit far
apart in lightness:

| Piece            | Dark      |
| :--------------- | :-------- |
| C, wall, last o  | `#ffffff` |
| First o, roof, middle o, last D | `#7d948a` |
| First D          | `#c3d0ca` |
| e                | `#52695f` |

The light theme keeps its colors, which already differ in lightness, and has
no outline: it added clutter without helping legibility.

For favicons and app icons, use the compact mark: C, o and the house.
`favicon.svg` follows the browser's color scheme; the PNG and ICO sit on a
Forest tile. Legibility at 16 px is still weak and remains an open problem.


## Color

Two themes. Dark is at least as important as light: most students use it.

### Dark: Forest

A forest at night, lit by a party. White and gray carry the structure;
saturated colors are light sources.

| Token      | Value     | Content   | Use                          |
| :--------- | :-------- | :-------- | :--------------------------- |
| base-200   | `#0d211a` |           | Page background              |
| base-100   | `#15302a` |           | Cards, surfaces              |
| base-300   | `#1f4034` |           | Borders, dividers            |
| content    | `#e6f0ea` |           | Text                         |
| muted      | `#8fb3a4` |           | Secondary text (no DaisyUI token; `text-base-content/70` is close) |
| neutral    | `#081510` | `#e6f0ea` | Terminal, dark blocks        |
| primary    | `#4aa0ff` | `#04121f` | Main action, links           |
| secondary  | `#ffc400` | `#0d211a` | Secondary action             |
| accent     | `#ff4d97` | `#0d211a` | Highlights, new items        |
| info       | `#00d2e6` | `#0d211a` | Information, focus ring      |
| success    | `#4cd08a` | `#0d211a` | Success                      |
| warning    | `#ff6f1a` | `#0d211a` | Warning                      |
| error      | `#ff5c5c` | `#0d211a` | Errors, destructive actions  |
| firefly    | `#b5f000` |           | Decorative light only        |

### Light: Cerrado

Brasília in the dry season: lime-washed walls, red earth, ipês, buriti palms
and the blue of Athos Bulcão's tiles. References stay subtle; none of the
colors carry place names in the UI.

| Token      | Value     | Content   | Use                          |
| :--------- | :-------- | :-------- | :--------------------------- |
| base-200   | `#f7f3ea` |           | Page background (lime wash)  |
| base-100   | `#fffdf8` |           | Cards, surfaces              |
| base-300   | `#e6dfd0` |           | Borders, dividers            |
| content    | `#1f2a24` |           | Text                         |
| muted      | `#5f6862` |           | Secondary text (no DaisyUI token; `text-base-content/70` is close) |
| neutral    | `#1f2a24` | `#f7f3ea` | Terminal, dark blocks        |
| primary    | `#1b4b9b` | `#ffffff` | Main action, links (tile blue) |
| secondary  | `#f2b800` | `#1f2a24` | Secondary action (yellow ipê) |
| accent     | `#a8309a` | `#ffffff` | Highlights (purple ipê)      |
| info       | `#2670c0` | `#ffffff` | Information (sky)            |
| success    | `#337a27` | `#ffffff` | Success (buriti)             |
| warning    | `#e0731f` | `#1f2a24` | Warning                      |
| error      | `#b5452a` | `#ffffff` | Errors (red earth)           |

Every text pair meets WCAG AA (4.5:1) against the page background and, except
where noted, against cards: text on background and cards is above 12:1 in
both themes, muted text above 5:1, and each role color against its content
color above 4.5:1. The light secondary (ipê yellow) is a fill only; it is
1.6:1 as text on the background and must never be used for text. Light
warning is 2.9:1 as text for the same reason.

### CLI

The CLI maps the same roles onto the 16 ANSI colors and its Textual theme:
red is error, green success, yellow secondary or warning, blue primary,
magenta accent, cyan info, bright black muted. Terminals choose their own
palette, so the CLI should not depend on exact hues.


## Type

| Role     | Family                | Notes                                  |
| :------- | :-------------------- | :------------------------------------- |
| Display  | Fraunces 700          | `SOFT` 100, `WONK` 1. Headings, course names, empty-state titles |
| Body     | Atkinson Hyperlegible | Designed for low-vision readers. Body, UI, exams |
| Mono     | JetBrains Mono        | Code, course codes, timers, eyebrows   |

All three cover Latin Extended, so Portuguese renders without fallback glyphs.


## Shape and texture

- **Radius.** Irregular, like hand-cut paper:
  `18px 6px 20px 8px / 8px 20px 6px 18px` for cards and buttons, a smaller
  version for badges and chips. Inputs and exam options use a plain 8 px.
- **Tilt.** Cards alternate -0.4° and 0.3°. Buttons tilt 1.5° on hover.
- **Tape.** A strip of translucent yellow tape on top of loud cards.
- **Grain.** A faint paper texture on the page background.
- **Ghost buttons** use a wavy underline.

Quiet screens use the radius and nothing else from this list.


## Motifs

- **Athos Bulcão tiles.** Square tiles with one figure each (half-disc,
  quarter disc, disc, band), rotated in steps of 90° as the workers who laid
  Athos's panels did. Uses: a 2×2 block derived from each course code for
  course lists and the sidebar (the same course always gets the same block),
  and full tiled walls behind whole sections of loud pages, with paper cards
  taped on top. Not as thin divider strips. Walls use the `soft` tone: the
  checkerboard ground stays and the figures fade to 45%, so the cards read
  first. Figures, colors and turns are drawn at random per tile. Tiles
  keep a fixed size (40 px on phones, 60 px from 768 px) and the wall is
  cropped to the section.
- **Party lights.** A string of colored bulbs. Celebrations only.
- **Fireflies and stars.** Night decoration in the dark theme.
- **The house.** From the logo's H. Home icon, and small houses on a hill
  for community-themed art.


## Illustration

Figurative, but suggested by the logo's pieces rather than drawn literally.
Subjects are generic computing and science ideas, not places:

- a binary tree whose leaves are lit,
- someone coding late at night,
- a graph of stars over a few houses.

They are night scenes, drawn on a dark panel in both themes, and light
sources (leaves, screens, bulbs, stars) glow. On the light theme the panel
reads as a picture taped to the page. `src/components/brand/Scene.astro`
renders them from `scenes.ts`.


## Icons

Filled, two tones (content and one accent), on a 24-unit grid, built from the
same primitives: house, a building on pilotis for courses, a sheet with an
answer bubble for exams, a grid for the calendar, stacked sheets for
resources, a speech bubble for questions, two figures for students, an ipê
flower for released grades.


## Open problems

- Logo legibility at 16 px.
- Ipê windows as configuration: where it lives and who edits it.
- Light-theme illustrations: today they reuse the night scenes on a dark panel.


## Design pages

The design system pages render the real tokens and components and are kept
current with this document.

| Page                 | Content                                              |
| :------------------- | :--------------------------------------------------- |
| `/design/brand`      | Logo in both themes and all sizes, pieces, flanks, ipê calendar |
| `/design/motifs`     | Athos Bulcão tiles, course tiles, icons, illustrations |
| `/design/themes`     | Both themes side by side, rendering the same screens |
| `/design/typography`, `/design/colors`, `/design/elements` | Type, tokens and components |
