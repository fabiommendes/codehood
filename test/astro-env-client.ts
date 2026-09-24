/**
 * Stands in for `astro:env/client` when a spec imports a module that reads
 * from it (`src/utils/schedule-time.ts`), outside of Astro's own build.
 *
 * `astro:env/client` is a virtual module Astro's Vite plugin resolves; the
 * unit tests here run under Playwright's own TypeScript loader, which never
 * goes through Vite and so cannot resolve it. `tsconfig.json` maps the
 * specifier to this file for that resolution alone — inside the real
 * Astro/Vite pipeline (dev, build), Astro's own `env` plugin runs with
 * `enforce: "pre"` and claims the specifier first, so this mapping is never
 * reached there. Keep this in sync with the `default` in `astro.config.mjs`'s
 * `env.schema.SERVER_TZ`.
 */
export const SERVER_TZ = "America/Sao_Paulo";
