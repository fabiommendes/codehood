# Visual identity briefing

Input for the visual identity proposal: what exists today, and what the client
interview settled. The proposal itself will live next to this file once the
interview is done.


## Current state

Taken from `src/styles/global.css`, `public/logo.svg` and the landing and login
pages as of 2026-09-28.

- **Logo.** Geometric letterforms built from half-discs, circles and blocks in
  four saturated colors, overlapping with multiply blending, plus a few gray
  squares around it. Reads as Bauhaus or toy blocks: playful, hand-made.
- **Dark mode logo.** Goes grayscale with red dots only. Loses most of what
  makes it recognizable.
- **Palette.** The "Flat UI Colors" set (Belize Hole, Pomegranate, Sun Flower,
  Nephritis, Clouds). DaisyUI primary is the logo blue; secondary is teal and
  accent is purple, neither of which appears in the logo.
- **Type.** Space Grotesk for headings, IBM Plex Sans for body, IBM Plex Mono
  for code and kickers.
- **Shape.** Theme radius is 4 to 6 px, but the landing page uses pill buttons
  with a glow, so the two disagree.
- **Landing page.** Dark, low-contrast, terminal mockup, browser mockup,
  gradient kickers. Close to the generic developer-tool look (Vercel, Linear)
  and unrelated to the logo.
- **Ornaments.** `.stripe-brand` (four-color bar) and `.bg-confetti` (scattered
  rotated squares) are the only elements that carry the logo into the UI.
- **Copy language.** English throughout.


## Interview

Questions and answers, grouped by round.


### Round 1: audience, personality, constraints

**Audience and context.** Students, mostly in computing and technology. They
use Codehood on laptops, on phones, and through the CLI (`codehood-cli`). The
audience is international; a Portuguese translation will come later.

**Personality.** Playful and hand-made, not the generic "professional
developer tool" look. The goal is to make technology feel human: teaching and
learning should feel welcoming, and so should the site.

**Constraints.** The logo may change as long as it keeps the idea of colorful
geometric shapes. The current palette carries no weight and can be replaced.

**Consequences drawn by the designer.**

- Fonts must cover Latin Extended so Portuguese (and other European languages)
  renders without fallback glyphs.
- Layouts must work on a phone first. Taking an exam on a phone is a real case.
- The identity must survive in a terminal: the palette needs a mapping onto the
  16 ANSI colors and Textual themes, not only CSS.


### Round 2: visual direction

Three directions were presented, all built on colorful geometric shapes. They
are rendered side by side at `/design/identity`
(`src/pages/design/identity.astro`), each with a logo study, palette, type,
components, a course card, an exam in progress, an empty state and the CLI
output.

- **A. Bauhaus poster.** Primary colors, flat shapes, heavy geometric type
  (Jost) on warm paper.
- **B. Cut paper.** Hand-cut shapes with multiply overlaps, warm palette, soft
  serif (Fraunces) with Atkinson Hyperlegible for body text.
- **C. Building blocks.** Outlined pieces with hard offset shadows, saturated
  colors, pressable buttons (Bricolage Grotesque).

All three share one wordmark geometry: lowercase letters built from discs,
bars and arches, with a Pac-Man `c`.

Open questions: which direction (or mix); figurative illustration or abstract
shapes only; how much personality inside the working screens; the weight of
dark mode.


### Round 3: direction chosen, logo reopened

**Direction.** B, cut paper, is the front-runner.

**Logo.** None of the three wordmarks worked; the constructed `e` read badly in
all of them. The client prefers the idea of the original logo: the word
suggested by geometric pieces, not spelled letter by letter. Five studies along
that line are at `/design/logo` (`src/pages/design/logo.astro`):

- **V1. The original, recut.** Current logo in the cut-paper palette.
- **V2. Frieze.** One primitive per letter in a row; stacks into two rows.
- **V3. Code and a house.** A cluster for "code", a house for "hood" (windows
  as the o's, door as the d).
- **V4. Quilt.** Eight tiles, one per letter.
- **V5. Hooded figure.** A figure in a hood next to the name set in Fraunces.

**Illustration.** Figurative, but only suggested by the same geometric pieces.
No literal drawings.


### Round 4: logo, personality, dark mode

**Logo.** V1, the original logo recut from paper: same pieces, cut-paper
palette, rough edges.

**Personality.** Strong at the edges (landing, empty states, error pages,
released grades, first visit) and quiet where people work (exam in progress,
reading material, grade tables).

**Dark mode.** At least as important as light: most students avoid light
themes. Dark kraft, colored paper glued onto dark brown card, is the dark
theme candidate. Both themes are at `/design/kraft`
(`src/pages/design/kraft.astro`), dark first.

**Kept for later.** The quilt (V4): square tiles, each a shape on a colored
ground. Candidate uses: course tiles in lists and the sidebar (one generated
quilt tile per course, which also fixes the ambiguous course dots of N3 in
`docs/ux/navigation.md`), default avatars, section dividers and the
background of the login page.


### Round 5: palette reference, logo refinements

**Palette reference.** A samba school on a Rio hill, the Sugarloaf and the
Atlantic Forest. The resulting "Morro" palette: Portela blue, Mangueira pink,
forest green, ipê yellow, brick, turquoise, Salgueiro red and granite, each in
a deep tone for light grounds and a bright one for dark grounds. Candidate dark
grounds: Earth (dark kraft) and Forest (deep green). Light ground: Sand.

**Logo.** The pieces of V1 stay in principle, but alignment, scale and shapes
are open. Nine arrangements are at `/design/morro`
(`src/pages/design/morro.astro`): original, on the baseline, samba, fan,
Sugarloaf, house on the hill, big C, confetti and stacked.


### Round 6: community, night forest

**Place.** Rio was only a loose reference; the idea behind it is the favela as
a community. Neither the client nor the project has ties to Rio, so color names
must not point there. If a geographic reference is wanted, it should be
Brasília.

**Dark theme.** The Forest ground (deep green) wins. The logo colors on it did
not work. New reference: a forest at night, with moonlight, fireflies,
reflections, shooting stars and the colored lights of a party. Explored at
`/design/night` (`src/pages/design/night.astro`): a night palette, four
treatments of the logo (paper, lanterns, fireflies, party lights), the house
icon, a community of houses on a hill, and strings of bulbs as dividers.

**Motifs.** The house on the hill is worth exploring; confetti maybe. Neither
is decided for the main logo.


### Round 7: contrast

**Dark logo.** The night treatments lacked contrast. On dark grounds the logo
should carry white pieces and fewer colors, with grays as in the current dark
logo. Moonlight and party pink were too soft; accents must be saturated.
Six schemes, each with the H and with a house in its place, are at
`/design/dark-logo` (`src/pages/design/dark-logo.astro`).

**Illustration.** The figurative scenes (houses on a hill, party lights) are
approved for use in parts of the site.


### Round 8: dark logo chosen, flanks, Brasília

**Dark logo.** Scheme F with the house: white and gray pieces, the H replaced
by a house whose only color is a lit amber window.

**Flanks.** The two pairs of squares beside the logo become a variable slot.
The main logo keeps the squares; other uses may swap them for party lights,
fireflies with a shooting star, or other motifs.

**Brasília.** Approved as the geographic reference, including iconography and
figurative art.

**Small sizes.** No logo so far is legible at small sizes. A variant with a
black outline is under test for very small uses, together with a clean version
(no cut edges, tilt or flanks) and a compact mark (C, o and the house).

All of the above is at `/design/brasilia` (`src/pages/design/brasilia.astro`):
flanks, small sizes, Cerrado palette, Athos Bulcão tiles, icons, and two
scenes (the Esplanada in the afternoon, a superquadra at night).


### Round 9: small sizes, Brasília kept subtle

**Small sizes.** Still hard to read. The outline should go around the whole
drawing, not each piece, and small uses need higher contrast between pieces.
Retested at `/design/brasilia` with a two-tone high-contrast scheme and an
outer outline.

**Brasília.** Athos Bulcão is the reference for tiles and backgrounds. The
Congress goes (it is the part locals like least); the JK bridge or the Conjunto
Nacional are better sources. References to the city must stay subtle.


### Round 10: tone steps, flanks, computing scenes

**Small sizes.** "High contrast" means more distance between the tones of
neighboring pieces, so each letter separates from the next. The outline helps;
on dark grounds it should be white.

**Scenes.** No Brasília scenes. Figurative art should illustrate generic
computing and science ideas: code, computers, data structures.

**Flanks.** Party lights work best when the string crosses the whole logo.
Ipê flanks should be fuller, like the pompoms of the flowers, one color per
variant. Idea to explore: switch the flanks to the ipê in bloom during the dry
season.


### Round 11: small logo settled, ipê redrawn

**Small sizes.** Tone steps give the best reading. A full-strength outline
cluttered the drawing; a 1.5 px outline at 50% opacity is under test.

**Ipê.** The pompoms did not look like ipês. Real ipês bloom in large round
clusters of trumpet-shaped flowers at the tips of leafless branches. The
flanks now show bare branches with clusters of trumpets, each with a
contrasting throat. In Brasília the usual order is purple, pink, yellow and
white, through the dry season; the exact months vary from year to year.


### Round 12: consolidation

**Ipê.** No branches; clusters sit close together and overlap.

**Small sizes.** The 1.5 px outline at 50% opacity stays. Legibility is still
weak, but it is the best option so far.

**Both themes** are compared at `/design/themes`
(`src/pages/design/themes.astro`). The approved identity is written up in
[identity.md](identity.md).


### Round 13: implementation

**Light logo.** Monochrome applies to the dark theme only. In the light theme
the logo keeps its colors, now from the Cerrado palette.

The themes, fonts and logo are applied (`src/styles/global.css`,
`src/components/Logo.astro`, `pnpm run brand`). The exploration pages were
replaced by `/design/brand`, `/design/motifs` and `/design/themes`, which
track the current identity; the explorations themselves are described in the
rounds above.


### Round 14: landing review

**Small logo, light theme.** The outline is gone: it did not help
legibility and added clutter. The dark theme keeps it.

**Bug.** Above 32 px the dark logo was blended with multiply, which turned its
white pieces nearly black on the Forest ground. The blend mode now comes from
the theme (`--lp-blend`).

**Tile walls.** The full-color wall behind "How it works" was too busy. Tones
were compared side by side (full, soft, muted, faint, veil); `soft`
(checkerboard kept, figures at 45%) won, and the "Got a course code?" section
sits on the same kind of wall. The columns used to repeat, because the
placement formula was linear; placement is now random per tile.

**Login and invite.** Three backdrops were compared: a tiled wall, the houses
on the hill with the card in the sky, and a split screen. Tiles won for both
screens. Tiles now
keep a fixed size, so phones show more of them instead of bigger ones.

**Landing.** "Why Codehood" went from four icon columns to two illustrated
items. The closing card takes the course code (the in-class passphrase) and
sends it through the login to `/courses/join`. The footer lost the second
mark. No tagline: "the learning community" was a placeholder and is gone.
