import path from "node:path";
import { build } from "esbuild";

/**
 * Bundle modules for a real browser page, exposing their exports on one global.
 *
 * @param sources Export statements resolved from the repository root, with the `@` alias.
 */
export async function bundleForBrowser(
	globalName: string,
	sources: readonly string[],
): Promise<string> {
	const bundle = await build({
		stdin: { contents: sources.join("\n"), resolveDir: path.resolve(".") },
		alias: { "@": path.resolve("src") },
		bundle: true,
		write: false,
		platform: "browser",
		format: "iife",
		globalName,
		logLevel: "silent",
	});
	const text = bundle.outputFiles[0]?.text;
	if (!text) throw new Error("Browser bundle is empty");
	return text;
}

export const STORAGE_MODULE =
	'export * from "@/services/answer-edits/storage";';
