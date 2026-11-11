/**
 * The runner plugins that ship with Codehood.
 *
 * A configuration lists the ones it wants in `runner.languages`; without
 * that key it gets `defaultRunners()`.
 */

import type { RunnerPlugin } from "../plugin";
import elm from "./elm";
import javascript from "./javascript";
import lua from "./lua";
import prolog from "./prolog";
import python from "./python";
import typescript from "./typescript";

export { elm, javascript, lua, prolog, python, typescript };

/** The languages an instance runs unless its configuration says otherwise. */
export function defaultRunners(): RunnerPlugin[] {
	return [python(), javascript(), typescript()];
}
