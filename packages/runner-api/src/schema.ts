/**
 * Schemas of the values a plugin shares with the runner protocol.
 */

import { z } from "zod";
import type { RunMode } from "./driver";

/**
 * Id of a language, as a runner plugin declares it.
 *
 * Any well-formed id parses: which ones a frame runs depends on the plugins
 * its build lists.
 */
export const languageId = z
	.string()
	.max(32)
	.regex(/^[a-z][a-z0-9-]*$/);

/** How a driver runs the files: once from the entry file, or as a read-eval-print loop. */
export const runMode = z.enum(["script", "repl"] satisfies RunMode[]);
