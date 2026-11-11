/**
 * TypeScript driver: strips the types with sucrase and runs the result on the
 * JavaScript driver.
 *
 * Types are removed, never checked, so a type error does not stop the
 * program. Sucrase keeps every statement on its original line, so a stack
 * points at the right line of the `.ts` file. Only the entry file runs; an
 * `import` of another file fails with a hint, as it does in JavaScript.
 */

import {
	type Driver,
	type LoadContext,
	type RunContext,
	runtimePath,
} from "@codehood/runner-api/driver";
import { javascriptDriver } from "../javascript/driver";
import { formatSyntaxError } from "../javascript/syntax-error";
import { sucrase } from "./runtime";

type Transform = (
	code: string,
	options: {
		transforms: string[];
		filePath: string;
		disableESTransforms: boolean;
	},
) => { code: string };

let transform: Transform | null = null;

/// Messages the engine gives when the program has an `import` or `export`.
const MODULE_SYNTAX = /Cannot use import statement|Unexpected token 'export'/;

/// Hint added after a module syntax error.
const MODULE_HINT =
	"Imports and exports between files are not supported: put the program in a single file.\n";

export const typescriptDriver: Driver = {
	language: "typescript",
	modes: ["script"],

	async load(ctx: LoadContext) {
		const url = ctx.runtimeUrl(runtimePath(sucrase, "sucrase.mjs"));
		({ transform } = (await import(/* @vite-ignore */ url)) as {
			transform: Transform;
		});
		await javascriptDriver.load(ctx);
	},

	async run(ctx: RunContext) {
		if (!transform) throw new Error("The TypeScript runtime was not loaded.");
		const source = ctx.files[ctx.entry] ?? "";
		let code: string;
		try {
			code = transform(source, {
				transforms: ["typescript"],
				filePath: ctx.entry,
				disableESTransforms: true,
			}).code;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			// Sucrase wraps the message as `Error transforming <file>: <text> (line:column)`
			// and sets `loc`, with a 1-based column.
			const loc = (error as { loc?: { line: number; column: number } }).loc;
			const text = message
				.replace(/^Error transforming .*?: /, "")
				.replace(/ \(\d+:\d+\)$/, "");
			if (!loc) {
				ctx.stderr(`${ctx.entry}: SyntaxError: ${message}\n`);
				return 1;
			}
			const at = { line: loc.line, column: Math.max(0, loc.column - 1) };
			const described = `SyntaxError: ${text}`;
			ctx.stderr(`${formatSyntaxError(ctx.entry, source, at, described)}\n`);
			ctx.diagnose({ file: ctx.entry, ...at, message: described });
			return 1;
		}
		return javascriptDriver.run({
			...ctx,
			files: { ...ctx.files, [ctx.entry]: code },
			stderr(text) {
				ctx.stderr(MODULE_SYNTAX.test(text) ? `${text}${MODULE_HINT}` : text);
			},
		});
	},
};

export default typescriptDriver;
