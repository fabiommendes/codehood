/**
 * Runtime packages of the runner plugins that ship with Codehood, by name.
 *
 * Each plugin declares its own in `runtime.ts`; this table is for tests.
 */

import { guida } from "./elm/runtime";
import { wasmoon } from "./lua/runtime";
import { swipl } from "./prolog/runtime";
import { pyodide } from "./python/runtime";
import { sucrase } from "./typescript/runtime";

export const RUNTIMES = { swipl, pyodide, wasmoon, sucrase, guida };
