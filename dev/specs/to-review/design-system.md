# Design system

## Scope

Fonts, colors, spacing (roadmap 0.1.0's "Design system" milestone), the
`/design/*` showcase, and the layouts/components those showcase pages
document. Implemented directly rather than spec-then-build, since the
request was fully specified up front (Typography/Colors/Layouts/Elements
now, Forms deliberately deferred).

## Design decisions

### Theme reuses the existing brand mark's palette, not an invented one

`public/logo.svg`/`favicon.svg` already use a five-color "flat UI colors"
palette (Belize Hole blue, Pomegranate red, Sun Flower yellow, Nephritis
green, Clouds gray). Rather than pick new brand colors, the daisyUI theme
in `src/styles/global.css` (`@plugin "daisyui/theme" { name: "codehood"; }`)
maps that exact palette onto daisyUI's semantic tokens — blue→primary,
red→error, yellow→warning, green→success, gray family→base surfaces — and
fills in secondary/accent (turquoise, amethyst) from the same canonical
palette rather than inventing new hues. `warning-content` is dark navy, not
white — Sun Flower yellow is too light for white text to pass contrast; every
other `*-content` is white.

Only one theme is defined (`themes: codehood --default;` disables the
built-in `light`/`dark` themes). No dark mode yet — out of scope until
there's a reason to build the toggle.

### Typography: three fonts, one job each

Space Grotesk (headings, via a global `h1`–`h6` rule), IBM Plex Sans (body,
the `body` default), IBM Plex Mono (code). Registered as Tailwind v4 theme
tokens (`--font-sans`/`--font-display`/`--font-mono` in an `@theme` block),
so `font-display`/`font-mono` are usable as ordinary utility classes anywhere,
not just where the base rules apply. Same three faces already chosen for the
landing page design (published separately as a Claude Design artifact) —
kept consistent rather than picking again.

### Four layouts, one job each

- **`Layout`** — the base `<html>`/`<head>` shell: global CSS, Google Fonts
  link, favicon, a `title` prop. Every other layout wraps this one; pages
  never use it directly.
- **`AppLayout`** — the logged-in app shell: a navbar showing Profile/Log out
  when `Astro.locals.user` is set, Log in otherwise. Used by `/` and
  `/profile`.
- **`CenteredLayout`** — a single centered card for pages whose whole job is
  one form. Used by `/login` and `/invite/[token]`, replacing markup that
  was previously duplicated identically in both files.
- **`DesignLayout`** — this section's own shell: a slim navbar plus the
  Overview/Typography/Colors/Layouts/Elements/Forms tab strip.

### Four UI components, matching what the app already needed

`src/components/ui/{Button,Badge,Alert,Card}.astro` — thin wrappers around
the daisyUI class conventions already in use across login/invite/profile
before this change (`btn`, `badge`, `alert`, `card card-border`). Kept
deliberately small: props map directly to daisyUI's own modifier classes
(`variant`, `size`, `style`) rather than inventing a parallel API. No
form-element components yet — that's the deferred Forms page's job, and
existing pages still use raw `fieldset`/`input`/`select` markup.

### Existing pages were refactored onto the new layouts, not left orphaned

`/`, `/login`, `/invite/[token]`, and `/profile` now use `AppLayout` or
`CenteredLayout` instead of the bare `Layout` + duplicated wrapper markup
they had before. This was necessary for the Layouts showcase page to
document real, currently-used patterns rather than aspirational ones nobody
calls.

### `/design/*` is public, not linked from the app nav

No auth check — it's a reference for whoever's building UI, not an
end-user-facing feature, so it doesn't need to be behind login. Not linked
from `AppLayout`'s nav either, to keep the real product chrome uncluttered;
reachable by direct URL as the roadmap item names it.

## Out of scope for now

- `/design/forms` is a stub (an info `Alert` saying it's under
  construction) — explicitly requested to be left unbuilt.
- Dark mode / theme switching.
- Form-element components (Input, Select, Fieldset wrappers) — waits for
  the Forms page.
