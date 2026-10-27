import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { expect, test } from "@playwright/test";
import { writeZip, type ZipFile } from "@/services/git/zip";
import { TEST_RESOURCE_ROOT } from "./env";

/// The zip writer checked with the real `unzip` and `zipinfo` binaries.

const ROOT = "proj";
/// Even seconds, because the DOS timestamp has a two-second resolution.
const DATE = new Date("2024-03-05T10:20:30Z");

const zipRoot = path.join(TEST_RESOURCE_ROOT, "git-zip");
mkdirSync(zipRoot, { recursive: true });
const workDir = mkdtempSync(path.join(zipRoot, "run-"));

type Source = { path: string; mode: "100644" | "100755"; bytes: Buffer };

/// Pseudo-random but reproducible, so a failure reproduces.
function patterned(length: number, seed: number): Buffer {
	const bytes = Buffer.alloc(length);
	let state = seed >>> 0;
	for (let i = 0; i < length; i++) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		bytes[i] = state >>> 24;
	}
	return bytes;
}

const SOURCES: Source[] = [
	{
		path: "run.sh",
		mode: "100755",
		bytes: Buffer.from("#!/bin/sh\necho hi\n"),
	},
	{ path: "src/pkg/mod.py", mode: "100644", bytes: Buffer.from("x = 1\n") },
	{ path: "src/main.py", mode: "100755", bytes: Buffer.from("import pkg\n") },
	{ path: "a.txt", mode: "100644", bytes: Buffer.from("lower\n") },
	{ path: "Z.txt", mode: "100644", bytes: Buffer.from("upper\n") },
	{ path: "bin/data.bin", mode: "100644", bytes: patterned(70_000, 1) },
	{ path: "bin/zeros.bin", mode: "100644", bytes: Buffer.alloc(100_000) },
	{ path: "empty.txt", mode: "100644", bytes: Buffer.alloc(0) },
];

/// Source paths in byte order, with the archive root in front.
const SORTED_ENTRIES = [
	"proj/Z.txt",
	"proj/a.txt",
	"proj/bin/data.bin",
	"proj/bin/zeros.bin",
	"proj/empty.txt",
	"proj/run.sh",
	"proj/src/main.py",
	"proj/src/pkg/mod.py",
];

function zipFilesOf(sources: readonly Source[]): ZipFile[] {
	return sources.map((s) => ({
		path: s.path,
		mode: s.mode,
		size: s.bytes.length,
		open: () => Readable.from([s.bytes]),
	}));
}

async function collect(stream: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

async function zipBytes(
	sources: readonly Source[] = SOURCES,
	date = DATE,
): Promise<Buffer> {
	return collect(writeZip(zipFilesOf(sources), { root: ROOT, date }));
}

function saveZip(bytes: Buffer): string {
	const file = path.join(
		workDir,
		`${Math.random().toString(36).slice(2, 10)}.zip`,
	);
	writeFileSync(file, bytes);
	return file;
}

function tool(command: string, args: string[]): string {
	return execFileSync(command, args, { maxBuffer: 64 * 1024 * 1024 }).toString(
		"utf8",
	);
}

/// Error from reading a zip stream to the end, whether `writeZip` throws up
/// front or fails the stream.
async function zipError(files: ZipFile[]): Promise<unknown> {
	try {
		await collect(writeZip(files, { root: ROOT, date: DATE }));
	} catch (error) {
		return error;
	}
	throw new Error("expected writeZip to fail");
}

test.describe("writeZip", () => {
	test("gives the same bytes on two runs, whatever the input order", async () => {
		const first = await zipBytes();
		const second = await zipBytes([...SOURCES].reverse());

		expect(second.equals(first)).toBe(true);
	});

	test("opens with unzip -t", async () => {
		const file = saveZip(await zipBytes());

		expect(tool("unzip", ["-t", file])).toContain("No errors detected");
	});

	test("lists the entries under the root in byte order", async () => {
		const file = saveZip(await zipBytes());

		const names = tool("zipinfo", ["-1", file]).trim().split("\n");

		expect(names).toEqual(SORTED_ENTRIES);
	});

	test("marks 100755 files executable and 100644 files not", async () => {
		const file = saveZip(await zipBytes());

		const lines = tool("zipinfo", [file])
			.split("\n")
			.filter((line) => line.includes(`${ROOT}/`));

		const permissions = new Map(
			lines.map((line) => {
				const columns = line.trim().split(/\s+/);
				return [columns[columns.length - 1], columns[0]];
			}),
		);
		expect(permissions.get("proj/run.sh")).toBe("-rwxr-xr-x");
		expect(permissions.get("proj/src/main.py")).toBe("-rwxr-xr-x");
		expect(permissions.get("proj/a.txt")).toBe("-rw-r--r--");
		expect(permissions.get("proj/bin/data.bin")).toBe("-rw-r--r--");
		expect(permissions.size).toBe(SOURCES.length);
	});

	test("stamps every entry with the given date", async () => {
		const file = saveZip(await zipBytes());

		const stamps = tool("zipinfo", ["-T", file])
			.split("\n")
			.filter((line) => line.includes(`${ROOT}/`))
			.map((line) => line.trim().split(/\s+/).slice(-2, -1)[0]);

		expect(stamps).toHaveLength(SOURCES.length);
		expect(new Set(stamps)).toEqual(new Set(["20240305.102030"]));
	});

	test("clamps a date before 1980 to 1980-01-01", async () => {
		const file = saveZip(await zipBytes(SOURCES, new Date(0)));

		const stamps = tool("zipinfo", ["-T", file])
			.split("\n")
			.filter((line) => line.includes(`${ROOT}/`))
			.map((line) => line.trim().split(/\s+/).slice(-2, -1)[0]);

		expect(new Set(stamps)).toEqual(new Set(["19800101.000000"]));
	});

	test("extracts to the original bytes, including binary and subdirectories", async () => {
		const file = saveZip(await zipBytes());
		const out = mkdtempSync(path.join(workDir, "out-"));

		tool("unzip", ["-q", file, "-d", out]);

		for (const source of SOURCES) {
			const extracted = path.join(out, ROOT, source.path);
			expect(readFileSync(extracted).equals(source.bytes), source.path).toBe(
				true,
			);
			const executable = (statSync(extracted).mode & 0o111) !== 0;
			expect(executable, source.path).toBe(source.mode === "100755");
		}
	});

	test("compresses with deflate", async () => {
		const file = saveZip(await zipBytes());

		const listing = tool("zipinfo", [file]);

		expect(listing).toMatch(/proj\/bin\/zeros\.bin/);
		expect(listing).toMatch(/defN.*proj\/bin\/zeros\.bin/);
	});

	test("rejects two files with the same path with RangeError", async () => {
		const files = zipFilesOf([SOURCES[0] as Source, SOURCES[0] as Source]);

		expect(await zipError(files)).toBeInstanceOf(RangeError);
	});

	test("fails the stream with RangeError when a file yields fewer bytes than its size", async () => {
		const files: ZipFile[] = [
			{
				path: "short.txt",
				mode: "100644",
				size: 10,
				open: () => Readable.from([Buffer.from("12345")]),
			},
		];

		expect(await zipError(files)).toBeInstanceOf(RangeError);
	});

	test("fails the stream with RangeError when a file yields more bytes than its size", async () => {
		const files: ZipFile[] = [
			{
				path: "long.txt",
				mode: "100644",
				size: 3,
				open: () => Readable.from([Buffer.from("12345")]),
			},
		];

		expect(await zipError(files)).toBeInstanceOf(RangeError);
	});
});

test.describe("writeZip memory", () => {
	/// How far the resident set may grow while a ~50 MB archive streams out.
	/// The writer holds a few compression buffers (about 1 MB). Without
	/// `--expose-gc` the chunks already written stay as garbage for a while, so
	/// 20 MB proved flaky; 30 MB still fails an implementation that buffers the
	/// 50 MB archive.
	const MAX_RSS_GROWTH = 30 * 1024 * 1024;
	const FILE_COUNT = 5;
	const FILE_SIZE = 10 * 1024 * 1024;

	test.setTimeout(180_000);

	test("does not grow the resident set by more than 30 MB for a 50 MB archive", async () => {
		const dir = mkdtempSync(path.join(workDir, "big-"));
		const files: ZipFile[] = [];
		for (let i = 0; i < FILE_COUNT; i++) {
			const file = path.join(dir, `f${i}.bin`);
			const out = createWriteStream(file);
			for (let written = 0; written < FILE_SIZE; written += 1024 * 1024) {
				out.write(randomBytes(1024 * 1024));
			}
			await new Promise<void>((resolve, reject) => {
				out.on("error", reject);
				out.end(resolve);
			});
			files.push({
				path: `f${i}.bin`,
				mode: "100644",
				size: FILE_SIZE,
				open: () => createReadStream(file),
			});
		}

		// Warm up zlib and the stream machinery so one-off allocations are not
		// counted as growth.
		await collect(writeZip(zipFilesOf(SOURCES), { root: ROOT, date: DATE }));
		globalThis.gc?.();
		const baseline = process.memoryUsage().rss;
		let peak = baseline;
		let total = 0;
		const target = path.join(dir, "out.zip");
		const meter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				total += chunk.length;
				peak = Math.max(peak, process.memoryUsage().rss);
				callback(null, chunk);
			},
		});

		await pipeline(
			writeZip(files, { root: ROOT, date: DATE }),
			meter,
			createWriteStream(target),
		);

		expect(total).toBeGreaterThan(FILE_COUNT * FILE_SIZE * 0.95);
		expect(peak - baseline).toBeLessThan(MAX_RSS_GROWTH);
		expect(tool("unzip", ["-t", target])).toContain("No errors detected");
	});
});
