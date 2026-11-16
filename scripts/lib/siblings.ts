/**
 * Pure logic behind `scripts/check-siblings.ts` and `scripts/check-versions.ts`:
 * parsing of version files and the rules that compare the codehood checkout
 * with its sibling repository `../mdq`. Reading files and running git stay in
 * the scripts.
 */

/** A version split into the parts the checks compare. */
export interface Version {
	major: number;
	minor: number;
	patch: number;
}

/** Parses `X.Y.Z` (a pre-release or build suffix is ignored); null when it is not a version. */
export function parseVersion(text: string): Version | null {
	const match = /^\s*(\d+)\.(\d+)\.(\d+)/.exec(text);
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

/** True when both versions parse and agree on MAJOR.MINOR. */
export function sameMajorMinor(a: string, b: string): boolean {
	const left = parseVersion(a);
	const right = parseVersion(b);
	return (
		left !== null &&
		right !== null &&
		left.major === right.major &&
		left.minor === right.minor
	);
}

/** Orders two versions: negative when `a` is older, positive when newer, 0 when equal. */
export function compareVersions(a: Version, b: Version): number {
	return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** The `version` of a `package.json` text; null when absent. */
export function packageJsonVersion(text: string): string | null {
	const { version } = JSON.parse(text) as { version?: unknown };
	return typeof version === "string" ? version : null;
}

/** The `[project] version` of a `pyproject.toml` text; null when absent. */
export function pyprojectVersion(text: string): string | null {
	const project = /^\[project\]\s*$([\s\S]*?)(?=^\[)/m.exec(`${text}\n[`);
	const match = /^version\s*=\s*"([^"]+)"/m.exec(project?.[1] ?? "");
	return match?.[1] ?? null;
}

/// The requirement string of `name` in `dependencies`, e.g. `>=0.2.0`.
function dependencySpecifier(text: string, name: string): string | null {
	const match = new RegExp(`^\\s*"${name}\\s*([<>=!~][^"]*)?"`, "m").exec(text);
	return match ? (match[1] ?? "") : null;
}

/** The version `name` is required at least by `pyproject.toml` (`name>=X.Y.Z`); null when there is no lower bound. */
export function pyprojectLowerBound(text: string, name: string): string | null {
	const specifier = dependencySpecifier(text, name);
	return /^>=\s*(\d+\.\d+\.\d+)/.exec(specifier ?? "")?.[1] ?? null;
}

/** The version `name` is pinned to by `pyproject.toml` (`name==X.Y.Z`); null when it is not pinned. */
export function pyprojectPin(text: string, name: string): string | null {
	const specifier = dependencySpecifier(text, name);
	return /^==\s*(\d+\.\d+\.\d+)/.exec(specifier ?? "")?.[1] ?? null;
}

/** True when `text` is a full 40-digit commit SHA. */
export function isCommitSha(text: string): boolean {
	return /^[0-9a-f]{40}$/.test(text);
}

/** Everything the sibling check reads about `../mdq`, gathered by the script. */
export interface MdqSnapshot {
	/// Content of `.mdq-ref`, trimmed; null when the file is missing.
	ref: string | null;
	/// HEAD of `../mdq`.
	head: string;
	/// Porcelain status lines of mdq-js, mdq-py and schema.
	dirty: string[];
	/// Whether HEAD is contained in a remote branch; null when not checked.
	pushed: boolean | null;
	/// State of the `mdq-js` build output against its sources.
	dist: "fresh" | "stale" | "missing";
	/// Versions of the three mdq packages and the lower bound the CLI requires.
	versions: {
		js: string | null;
		py: string | null;
		schema: string | null;
		cliBound: string | null;
	};
}

/** State of a build output given the newest mtime of its files and of its sources, in ms. */
export function distState(
	distNewest: number | null,
	sourceNewest: number,
): "fresh" | "stale" | "missing" {
	if (distNewest === null) return "missing";
	return distNewest >= sourceNewest ? "fresh" : "stale";
}

/** The problems of a snapshot, each saying what to run to fix it. */
export function mdqProblems(snapshot: MdqSnapshot): string[] {
	const problems: string[] = [];
	const short = (sha: string) => sha.slice(0, 12);
	if (snapshot.ref === null) {
		problems.push("`.mdq-ref` is missing. Run `pnpm run mdq:bump`.");
	} else if (!isCommitSha(snapshot.ref)) {
		problems.push(
			`\`.mdq-ref\` does not hold a full commit SHA ("${snapshot.ref}"). Run \`pnpm run mdq:bump\`.`,
		);
	} else if (snapshot.ref !== snapshot.head) {
		problems.push(
			`../mdq is at ${short(snapshot.head)}, \`.mdq-ref\` says ${short(snapshot.ref)}. ` +
				`Run \`git -C ../mdq checkout ${short(snapshot.ref)}\`, or \`pnpm run mdq:bump\` to adopt ../mdq.`,
		);
	}
	if (snapshot.dirty.length > 0) {
		problems.push(
			`../mdq has uncommitted changes in mdq-js, mdq-py or schema:\n    ${snapshot.dirty.join("\n    ")}\n  Commit or discard them.`,
		);
	}
	if (snapshot.pushed === false) {
		problems.push(
			`../mdq ${short(snapshot.head)} is not on a remote branch. Push it from ../mdq.`,
		);
	}
	if (snapshot.dist !== "fresh") {
		problems.push(
			`../mdq/mdq-js/dist is ${snapshot.dist}. Run \`pnpm build\` in ../mdq/mdq-js.`,
		);
	}
	const { js, py, schema, cliBound } = snapshot.versions;
	const named: [string, string | null][] = [
		["mdq-js", js],
		["mdq-py", py],
		["schema", schema],
		["cli/pyproject.toml `mdq>=`", cliBound],
	];
	const unreadable = named.filter(([, version]) => version === null);
	for (const [name] of unreadable)
		problems.push(`No version found for ${name}.`);
	const known = named.filter(
		(entry): entry is [string, string] => entry[1] !== null,
	);
	const [first, ...rest] = known;
	if (first && rest.some(([, version]) => !sameMajorMinor(first[1], version))) {
		const list = known
			.map(([name, version]) => `${name} ${version}`)
			.join(", ");
		problems.push(
			`mdq versions differ in MAJOR.MINOR: ${list}. Align them in ../mdq, then update the \`mdq>=\` bound in cli/pyproject.toml.`,
		);
	}
	return problems;
}

/** A version file and the version it holds. */
export interface VersionEntry {
	file: string;
	version: string | null;
}

/** The problems of the server, CLI and worker versions, which must be one. */
export function lockstepProblems(
	entries: VersionEntry[],
	workerCliPin: string | null,
): string[] {
	const problems: string[] = [];
	for (const { file, version } of entries) {
		if (version === null) problems.push(`No version found in ${file}.`);
	}
	const known = entries.filter(
		(entry): entry is { file: string; version: string } =>
			entry.version !== null,
	);
	const [first] = known;
	if (first && known.some(({ version }) => version !== first.version)) {
		const list = known
			.map(({ file, version }) => `${file} ${version}`)
			.join(", ");
		problems.push(
			`Versions differ: ${list}. \`pnpm run release\` bumps all of them together.`,
		);
	}
	if (first && workerCliPin !== first.version) {
		problems.push(
			`workers/chalk-worker/pyproject.toml requires codehood-cli ${workerCliPin === null ? "without an == pin" : `==${workerCliPin}`}, the version is ${first.version}.`,
		);
	}
	return problems;
}
