import { readdirSync, readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/// Part of the URL of every chunk of the server build under test.
const SERVER_CHUNK = "/dist/server/";

interface V8Range {
	startOffset: number;
	endOffset: number;
	count: number;
}

interface V8Script {
	url: string;
	functions: { functionName: string; ranges: V8Range[] }[];
}

interface V8Coverage {
	result: V8Script[];
	"source-map-cache"?: Record<
		string,
		{ lineLengths: number[]; data: ConstructorParameters<typeof SourceMap>[0] }
	>;
}

/** Which sources of the server build ran, read from raw V8 coverage. */
export interface SourceCoverage {
	/// Sources with at least one function that ran, besides loading the module.
	ran: Set<string>;
	/// Sources the server loaded, whether or not any of their functions ran.
	loaded: Set<string>;
}

/// The 0-based line and column of `offset`, given the length of each line.
function position(
	lineStarts: number[],
	offset: number,
): { line: number; column: number } {
	let low = 0;
	let high = lineStarts.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if ((lineStarts[middle] ?? 0) <= offset) low = middle;
		else high = middle - 1;
	}
	return { line: low, column: offset - (lineStarts[low] ?? 0) };
}

/// Lines of a function probed for a mapping before giving up.
const PROBED_LINES = 50;

/// The original source of the generated code in `range`.
///
/// The first line of a compiled component often has no mapping of its own,
/// and `findEntry` then answers with the closest mapping before it, which may
/// belong to the module bundled just above. So each line is probed at its end
/// and only a mapping on that same line counts. A component made of markup
/// alone may have no mapping at all: then the chunk's only source, or as a
/// last resort the closest mapping before the function, answers.
function functionSource(
	map: SourceMap,
	lineLengths: number[],
	lineStarts: number[],
	range: V8Range,
): string | undefined {
	const first = position(lineStarts, range.startOffset).line;
	const last = Math.min(
		position(lineStarts, range.endOffset).line,
		first + PROBED_LINES,
	);
	for (let line = first; line <= last; line++) {
		const entry = map.findEntry(
			line,
			Math.max((lineLengths[line] ?? 0) - 1, 0),
		);
		if (
			"originalSource" in entry &&
			entry.originalSource &&
			entry.generatedLine === line
		) {
			return entry.originalSource;
		}
	}
	const { sources } = map.payload;
	if (sources.length === 1) return sources[0];
	const { line, column } = position(lineStarts, range.startOffset);
	const before = map.findEntry(line, column);
	return "originalSource" in before ? before.originalSource : undefined;
}

function toPath(source: string, root: string): string {
	const absolute = source.startsWith("file://")
		? fileURLToPath(source)
		: source;
	return path.relative(root, path.resolve(root, absolute));
}

/**
 * Reads the V8 coverage that the server under test wrote to `dir` and maps it
 * back to the sources of the build, paths relative to `root`.
 *
 * Needs a build with source maps (`COVERAGE=1`): Node stores the maps of the
 * scripts it ran next to their coverage.
 */
export function readServerCoverage(dir: string, root: string): SourceCoverage {
	const ran = new Set<string>();
	const loaded = new Set<string>();
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".json")) continue;
		const coverage = JSON.parse(
			readFileSync(path.join(dir, name), "utf8"),
		) as V8Coverage;
		const maps = coverage["source-map-cache"] ?? {};
		for (const script of coverage.result) {
			if (!script.url.includes(SERVER_CHUNK)) continue;
			const cached = maps[script.url];
			if (!cached?.data) continue;
			const map = new SourceMap(cached.data, {
				lineLengths: cached.lineLengths,
			});
			for (const source of map.payload.sources) {
				loaded.add(toPath(source, root));
			}
			const lineStarts: number[] = [];
			let start = 0;
			for (const length of cached.lineLengths) {
				lineStarts.push(start);
				start += length + 1;
			}
			for (const fn of script.functions) {
				const [whole] = fn.ranges;
				// The module itself: it runs whenever the chunk is imported.
				if (!whole || whole.startOffset === 0 || whole.count === 0) continue;
				const source = functionSource(
					map,
					cached.lineLengths,
					lineStarts,
					whole,
				);
				if (source) ran.add(toPath(source, root));
			}
		}
	}
	return { ran, loaded };
}
