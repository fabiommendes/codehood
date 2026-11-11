/**
 * Where a built sandbox bundle lives and what it holds, shared by the build
 * (`integration.ts`) and the endpoint that serves it (`assets.ts`).
 */

import { join } from "node:path";

/// Name of the directory that holds a built bundle, next to the server build.
export const BUNDLE_DIR_NAME = "runner-bundle";

/// Where `astro dev` keeps its bundle, relative to the project root.
export const DEV_BUNDLE_DIR = join(".astro", BUNDLE_DIR_NAME);

/// Name of the manifest inside a bundle directory: `{ version, files }`.
export const MANIFEST_NAME = "manifest.json";

/// Copies the production build writes next to each file that compresses
/// well, in the order the endpoint prefers them.
export const PRECOMPRESSED = [
	{ encoding: "br", extension: ".br" },
	{ encoding: "gzip", extension: ".gz" },
] as const;

/// A `Content-Encoding` the endpoint may send.
export type ContentEncoding = (typeof PRECOMPRESSED)[number]["encoding"];
