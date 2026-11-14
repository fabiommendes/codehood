/**
 * Summarises the `.cpuprofile` files the probe wrote during a scenario: the
 * functions that took the most CPU, by their own time and with their callees.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface CallFrame {
	functionName: string;
	url: string;
	lineNumber: number;
}

interface ProfileNode {
	id: number;
	callFrame: CallFrame;
	children?: number[];
}

interface CpuProfile {
	nodes: ProfileNode[];
	startTime: number;
	endTime: number;
	samples?: number[];
	timeDeltas?: number[];
}

export interface HotFunction {
	/// `name (file:line)`.
	name: string;
	/// Milliseconds sampled with the function on top of the stack.
	selfMs: number;
	/// Milliseconds sampled with the function anywhere on the stack.
	totalMs: number;
}

export interface ProfileSummary {
	files: string[];
	/// Milliseconds sampled in all, idle included.
	sampledMs: number;
	idleMs: number;
	gcMs: number;
	bySelf: HotFunction[];
	byTotal: HotFunction[];
}

/// V8's pseudo-frames: not code of the server.
const PSEUDO = new Set([
	"(root)",
	"(program)",
	"(idle)",
	"(garbage collector)",
]);

/// A short name for a frame: the package of a dependency, or the path inside the build.
function label(frame: CallFrame): string {
	const name = frame.functionName || "(anonymous)";
	if (!frame.url) return name;
	const url = frame.url.replace(/^file:\/\//, "");
	const pkg = url.match(
		/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/,
	);
	const where = pkg?.[1] ?? url.replace(/^.*\/(dist|src)\//, "$1/");
	return `${name} (${where}:${frame.lineNumber + 1})`;
}

/// Reads every `.cpuprofile` in `dir` and adds them up; null when there is none.
export function summariseProfiles(
	dir: string,
	top = 20,
): ProfileSummary | null {
	let files: string[];
	try {
		files = readdirSync(dir)
			.filter((f) => f.endsWith(".cpuprofile"))
			.sort();
	} catch {
		return null;
	}
	if (files.length === 0) return null;
	const self = new Map<string, number>();
	const total = new Map<string, number>();
	let sampledMs = 0;
	let idleMs = 0;
	let gcMs = 0;
	for (const file of files) {
		const profile = JSON.parse(
			readFileSync(path.join(dir, file), "utf8"),
		) as CpuProfile;
		const byId = new Map(profile.nodes.map((node) => [node.id, node]));
		const parent = new Map<number, number>();
		for (const node of profile.nodes)
			for (const child of node.children ?? []) parent.set(child, node.id);
		const samples = profile.samples ?? [];
		const deltas = profile.timeDeltas ?? [];
		for (let i = 0; i < samples.length; i++) {
			// A sample's time is the gap to the next one.
			const ms = Math.max(0, (deltas[i + 1] ?? deltas[i] ?? 0) / 1000);
			const leaf = byId.get(samples[i] ?? -1);
			if (!leaf) continue;
			sampledMs += ms;
			const leafName = leaf.callFrame.functionName;
			if (leafName === "(idle)") {
				idleMs += ms;
				continue;
			}
			if (leafName === "(garbage collector)") gcMs += ms;
			if (!PSEUDO.has(leafName)) {
				const key = label(leaf.callFrame);
				self.set(key, (self.get(key) ?? 0) + ms);
			}
			const seen = new Set<string>();
			for (
				let id: number | undefined = leaf.id;
				id !== undefined;
				id = parent.get(id)
			) {
				const frame = byId.get(id)?.callFrame;
				if (!frame || PSEUDO.has(frame.functionName)) continue;
				const key = label(frame);
				// Recursion counts a sample once per function.
				if (seen.has(key)) continue;
				seen.add(key);
				total.set(key, (total.get(key) ?? 0) + ms);
			}
		}
	}
	const rank = (map: Map<string, number>) =>
		[...map]
			.sort((a, b) => b[1] - a[1])
			.slice(0, top)
			.map(([name]) => ({
				name,
				selfMs: self.get(name) ?? 0,
				totalMs: total.get(name) ?? 0,
			}));
	return {
		files,
		sampledMs,
		idleMs,
		gcMs,
		bySelf: rank(self),
		byTotal: rank(total),
	};
}
