import { expect, test } from "@playwright/test";
import {
	compareVersions,
	distState,
	isCommitSha,
	lockstepProblems,
	type MdqSnapshot,
	mdqProblems,
	packageJsonVersion,
	parseVersion,
	pyprojectLowerBound,
	pyprojectPin,
	pyprojectVersion,
	sameMajorMinor,
} from "../scripts/lib/siblings";

const SHA = "8a39b82165046edccb52b44ad71e29faf91291bc";
const OTHER = "1111111111111111111111111111111111111111";

const PYPROJECT = `[project]
name = "x"
version = "0.4.0"
dependencies = [
    "httpx>=0.28.1",
    "mdq>=0.2.0",
    "codehood-cli==0.4.0",
    "plain",
]

[tool.uv.sources]
mdq = { path = "../mdq", editable = true }
version = "9.9.9"
`;

/// A snapshot with nothing wrong.
function healthy(overrides: Partial<MdqSnapshot> = {}): MdqSnapshot {
	return {
		ref: SHA,
		head: SHA,
		dirty: [],
		pushed: true,
		dist: "fresh",
		versions: { js: "0.2.0", py: "0.2.1", schema: "0.2.0", cliBound: "0.2.0" },
		...overrides,
	};
}

test("parseVersion reads X.Y.Z and rejects anything else", () => {
	expect(parseVersion("1.22.3")).toEqual({ major: 1, minor: 22, patch: 3 });
	expect(parseVersion("0.2.0rc1")).toEqual({ major: 0, minor: 2, patch: 0 });
	expect(parseVersion("0.2")).toBeNull();
	expect(parseVersion("latest")).toBeNull();
});

test("sameMajorMinor ignores the patch and fails on unparseable input", () => {
	expect(sameMajorMinor("0.2.0", "0.2.9")).toBe(true);
	expect(sameMajorMinor("0.2.0", "0.3.0")).toBe(false);
	expect(sameMajorMinor("1.2.0", "0.2.0")).toBe(false);
	expect(sameMajorMinor("0.2.0", "nope")).toBe(false);
});

test("compareVersions orders by major, minor, then patch", () => {
	const v = (text: string) =>
		parseVersion(text) as NonNullable<ReturnType<typeof parseVersion>>;
	expect(compareVersions(v("0.2.0"), v("0.10.0"))).toBeLessThan(0);
	expect(compareVersions(v("1.0.0"), v("0.99.99"))).toBeGreaterThan(0);
	expect(compareVersions(v("0.2.1"), v("0.2.1"))).toBe(0);
});

test("packageJsonVersion reads the version or null", () => {
	expect(packageJsonVersion('{"version": "0.4.0"}')).toBe("0.4.0");
	expect(packageJsonVersion("{}")).toBeNull();
});

test("pyproject parsing reads only the [project] version", () => {
	expect(pyprojectVersion(PYPROJECT)).toBe("0.4.0");
	expect(pyprojectVersion('[tool.x]\nversion = "1.0.0"\n')).toBeNull();
});

test("pyproject dependency parsing tells lower bounds from pins", () => {
	expect(pyprojectLowerBound(PYPROJECT, "mdq")).toBe("0.2.0");
	expect(pyprojectLowerBound(PYPROJECT, "codehood-cli")).toBeNull();
	expect(pyprojectPin(PYPROJECT, "codehood-cli")).toBe("0.4.0");
	expect(pyprojectPin(PYPROJECT, "mdq")).toBeNull();
	expect(pyprojectLowerBound(PYPROJECT, "plain")).toBeNull();
	expect(pyprojectLowerBound(PYPROJECT, "missing")).toBeNull();
});

test("isCommitSha wants the full lowercase SHA", () => {
	expect(isCommitSha(SHA)).toBe(true);
	expect(isCommitSha(SHA.slice(0, 12))).toBe(false);
	expect(isCommitSha(SHA.toUpperCase())).toBe(false);
	expect(isCommitSha("main")).toBe(false);
});

test("distState compares the newest output with the newest source", () => {
	expect(distState(null, 10)).toBe("missing");
	expect(distState(9, 10)).toBe("stale");
	expect(distState(10, 10)).toBe("fresh");
	expect(distState(11, 10)).toBe("fresh");
});

test("a healthy snapshot has no problems", () => {
	expect(mdqProblems(healthy())).toEqual([]);
});

test("mdqProblems flags a missing, malformed or different ref", () => {
	expect(mdqProblems(healthy({ ref: null }))[0]).toContain("missing");
	expect(mdqProblems(healthy({ ref: "main" }))[0]).toContain("full commit SHA");
	const [problem] = mdqProblems(healthy({ head: OTHER }));
	expect(problem).toContain(SHA.slice(0, 12));
	expect(problem).toContain("mdq:bump");
});

test("mdqProblems flags dirty trees, unpushed commits and a bad build, and skips an unchecked push", () => {
	expect(mdqProblems(healthy({ dirty: [" M mdq-js/src/a.ts"] }))[0]).toContain(
		"mdq-js/src/a.ts",
	);
	expect(mdqProblems(healthy({ pushed: false }))[0]).toContain(
		"not on a remote",
	);
	expect(mdqProblems(healthy({ pushed: null }))).toEqual([]);
	expect(mdqProblems(healthy({ dist: "stale" }))[0]).toContain("pnpm build");
	expect(mdqProblems(healthy({ dist: "missing" }))[0]).toContain("missing");
});

test("mdqProblems flags a MAJOR.MINOR mismatch and unreadable versions", () => {
	const versions = {
		js: "0.3.0",
		py: "0.2.1",
		schema: "0.2.0",
		cliBound: "0.2.0",
	};
	const [problem] = mdqProblems(healthy({ versions }));
	expect(problem).toContain("MAJOR.MINOR");
	expect(problem).toContain("mdq-js 0.3.0");
	const cliBehind = { ...versions, js: "0.2.0", cliBound: "0.1.0" };
	expect(mdqProblems(healthy({ versions: cliBehind }))[0]).toContain(
		"MAJOR.MINOR",
	);
	const unreadable = { ...cliBehind, cliBound: null, js: "0.2.0" };
	expect(mdqProblems(healthy({ versions: unreadable }))).toEqual([
		expect.stringContaining("No version found for cli/pyproject.toml"),
	]);
});

test("lockstepProblems requires one version and a matching worker pin", () => {
	const entries = (a: string, b: string, c: string) => [
		{ file: "package.json", version: a },
		{ file: "cli/pyproject.toml", version: b },
		{ file: "worker", version: c },
	];
	expect(lockstepProblems(entries("0.4.0", "0.4.0", "0.4.0"), "0.4.0")).toEqual(
		[],
	);
	expect(
		lockstepProblems(entries("0.4.0", "0.2.0", "0.4.0"), "0.4.0")[0],
	).toContain("cli/pyproject.toml 0.2.0");
	expect(
		lockstepProblems(entries("0.4.0", "0.4.0", "0.4.0"), "0.3.0")[0],
	).toContain("==0.3.0");
	expect(
		lockstepProblems(entries("0.4.0", "0.4.0", "0.4.0"), null)[0],
	).toContain("without an == pin");
	expect(
		lockstepProblems([{ file: "package.json", version: null }], null)[0],
	).toContain("No version found in package.json");
});
