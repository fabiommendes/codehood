/**
 * Elm driver: the Guida compiler (a port of Elm 0.19.1 to JavaScript) on an
 * in-memory file system.
 *
 * `load` imports the compiler and downloads the package cache the build
 * made (`ELM_CACHE_FILE`, next to this module in the versioned bundle), so a
 * run never touches the network. `run` compiles the files, runs the entry
 * module's `tests` when it declares them and, in `repl` mode, opens the
 * Elm REPL with the entry module imported. Programs with a view are out of
 * reach: there is no DOM.
 */

import {
	type Driver,
	type LoadContext,
	type RunContext,
	runtimePath,
} from "@codehood/runner-api/driver";
import type { GuidaElm } from "./host";
import { ELM_CACHE_FILE, unpackFiles } from "./project";
import { guida } from "./runtime";
import { runElm } from "./session";

/// The compiler and the cache, loaded once per Worker.
let loaded: { elm: GuidaElm; cache: Map<string, Uint8Array> } | null = null;

export const elmDriver: Driver = {
	language: "elm",
	modes: ["repl", "script"],

	async load(ctx: LoadContext) {
		const url = ctx.runtimeUrl(runtimePath(guida, "guida.mjs"));
		const [module, response] = await Promise.all([
			import(/* @vite-ignore */ url) as Promise<{ default: GuidaElm }>,
			fetch(new URL(ELM_CACHE_FILE, import.meta.url)),
		]);
		if (!response.ok) {
			throw new Error(`The Elm package cache answered ${response.status}.`);
		}
		loaded = {
			elm: module.default,
			cache: unpackFiles(new Uint8Array(await response.arrayBuffer())),
		};
	},

	async run(ctx: RunContext) {
		if (!loaded) throw new Error("The Elm runtime was not loaded.");
		return runElm(loaded.elm, loaded.cache, ctx);
	},
};

export default elmDriver;
