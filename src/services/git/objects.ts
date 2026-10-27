/**
 * Git object names and encodings, computed without a git binary or a
 * repository on disk.
 *
 * Everything here works on values: bytes in, bytes or shas out. The one
 * exception is {@link looseObject}, which transforms a stream it is handed
 * and never opens a file itself.
 */
import { createHash } from "node:crypto";
import { pipeline, Readable } from "node:stream";
import { createDeflate } from "node:zlib";

/// The kinds of git object the server produces.
export type GitObjectKind = "blob" | "tree" | "commit";

/// The mode of a tree entry: a regular file, an executable, or a subtree.
/// Git writes a subtree as `40000`, without the leading zero.
export type GitTreeMode = "100644" | "100755" | "40000";

/// One line of a tree object: a single path segment, never a nested path.
export type GitTreeEntry = {
	name: string;
	mode: GitTreeMode;
	/// Lowercase-hex sha1 of the blob or subtree.
	sha: string;
};

/// One file of a flat file list, as a repository commit carries it.
export type GitFileEntry = {
	/// Relative path with `/` separators, already validated.
	path: string;
	mode: "100644" | "100755";
	/// Lowercase-hex sha1 of the blob.
	gitSha: string;
};

/// A tree object ready to store: its sha and its body without the header.
export type GitTreeObject = {
	sha: string;
	body: Buffer;
};

/// The trees of a nested file list, the root among them.
export type GitTreeSet = {
	/// Sha of the root tree.
	root: string;
	/// Every tree, the root included, each once, children before parents.
	trees: GitTreeObject[];
};

/// Author or committer of a commit.
export type GitSignature = {
	name: string;
	email: string;
	date: Date;
	/// Offset from UTC in minutes, as git writes `+hhmm`. Defaults to 0.
	timezoneOffset?: number;
};

/// The fields of a commit object.
export type GitCommit = {
	/// Sha of the root tree.
	tree: string;
	/// Parent commit shas, in order; empty for a root commit.
	parents: string[];
	author: GitSignature;
	committer: GitSignature;
	/// The message as stored, normally ending in a newline.
	message: string;
};

/// Matches the lowercase hex sha1 git uses to name objects.
const SHA_PATTERN = /^[0-9a-f]{40}$/;

type TreeNode = {
	files: Map<string, GitFileEntry>;
	dirs: Map<string, TreeNode>;
};

function isTreeMode(mode: string): mode is GitTreeMode {
	return mode === "100644" || mode === "100755" || mode === "40000";
}

/// The bytes git compares when sorting a tree: a subtree ends in `/`.
function sortKey(entry: GitTreeEntry): Buffer {
	const name = entry.mode === "40000" ? `${entry.name}/` : entry.name;
	return Buffer.from(name, "utf8");
}

function formatSignature(sig: GitSignature): string {
	const offset = sig.timezoneOffset ?? 0;
	const abs = Math.abs(offset);
	const hh = String(Math.floor(abs / 60)).padStart(2, "0");
	const mm = String(abs % 60).padStart(2, "0");
	const epoch = Math.floor(sig.date.getTime() / 1000);
	return `${sig.name} <${sig.email}> ${epoch} ${offset < 0 ? "-" : "+"}${hh}${mm}`;
}

function parseSignature(text: string): GitSignature {
	const m = /^(.*) <([^>]*)> (\d+) ([+-])(\d{2})(\d{2})$/.exec(text);
	if (!m) throw new SyntaxError(`malformed signature: ${text}`);
	const minutes = Number(m[5]) * 60 + Number(m[6]);
	return {
		name: m[1] as string,
		email: m[2] as string,
		date: new Date(Number(m[3]) * 1000),
		timezoneOffset: m[4] === "-" ? -minutes : minutes,
	};
}

/**
 * The header git prepends to an object body before hashing and compressing
 * it: `"<kind> <size>\0"`.
 *
 * @example
 * objectHeader("blob", 5).toString("latin1"); // "blob 5\0"
 */
export function objectHeader(kind: GitObjectKind, size: number): Buffer {
	return Buffer.from(`${kind} ${size}\0`, "latin1");
}

/**
 * The sha1 git gives an object of `kind` whose body is `body`.
 *
 * Hashes the header followed by the body, as `git hash-object -t <kind>`.
 */
export function objectSha(kind: GitObjectKind, body: Buffer): string {
	return createHash("sha1")
		.update(objectHeader(kind, body.length))
		.update(body)
		.digest("hex");
}

/**
 * The sha1 git gives a file with these bytes, as `git hash-object`.
 *
 * @example
 * blobSha(Buffer.alloc(0)); // "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
 */
export function blobSha(bytes: Buffer): string {
	return objectSha("blob", bytes);
}

/**
 * Orders two tree entries the way git sorts a tree.
 *
 * Names compare byte by byte, with a subtree compared as if its name ended
 * in `/`, so the files `a-b` and `a.txt` and the directory `a` sort as
 * `a-b`, `a.txt`, `a`.
 */
export function compareTreeEntries(a: GitTreeEntry, b: GitTreeEntry): number {
	return Buffer.compare(sortKey(a), sortKey(b));
}

/**
 * Serialises a tree body, sorting the entries in git order first.
 *
 * Each entry is `"<mode> <name>\0"` followed by the 20 raw bytes of its sha.
 * The input array is not mutated.
 *
 * @throws {RangeError} If two entries have the same name, a name is empty
 * or contains `/` or NUL, or a sha is not 40 lowercase hex digits.
 */
export function serializeTree(entries: readonly GitTreeEntry[]): Buffer {
	const seen = new Set<string>();
	for (const entry of entries) {
		if (
			entry.name === "" ||
			entry.name.includes("/") ||
			entry.name.includes("\0")
		) {
			throw new RangeError(
				`invalid tree entry name: ${JSON.stringify(entry.name)}`,
			);
		}
		if (!SHA_PATTERN.test(entry.sha)) {
			throw new RangeError(`invalid tree entry sha: ${entry.sha}`);
		}
		if (seen.has(entry.name)) {
			throw new RangeError(`duplicate tree entry: ${entry.name}`);
		}
		seen.add(entry.name);
	}
	const parts: Buffer[] = [];
	for (const entry of [...entries].sort(compareTreeEntries)) {
		parts.push(
			Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"),
			Buffer.from(entry.sha, "hex"),
		);
	}
	return Buffer.concat(parts);
}

/**
 * Reads a tree body back into its entries, in stored order.
 *
 * @throws {SyntaxError} If the body is not a well-formed tree.
 */
export function parseTree(body: Buffer): GitTreeEntry[] {
	const entries: GitTreeEntry[] = [];
	let pos = 0;
	while (pos < body.length) {
		const space = body.indexOf(0x20, pos);
		const nul = space < 0 ? -1 : body.indexOf(0, space);
		if (space < 0 || nul < 0 || nul + 21 > body.length) {
			throw new SyntaxError("malformed tree object");
		}
		const mode = body.toString("latin1", pos, space);
		if (!isTreeMode(mode)) {
			throw new SyntaxError(`unsupported tree mode: ${mode}`);
		}
		const name = body.toString("utf8", space + 1, nul);
		if (name === "") throw new SyntaxError("empty tree entry name");
		const sha = body.toString("hex", nul + 1, nul + 21);
		entries.push({ name, mode, sha });
		pos = nul + 21;
	}
	return entries;
}

/**
 * Builds every tree of a flat list of files, nesting directories by path.
 *
 * Directories with no files do not exist, as in git. The result does not
 * depend on the order of `files`.
 *
 * @example
 * buildTrees([{ path: "a/b.txt", mode: "100644", gitSha }]).trees.length; // 2
 *
 * @throws {RangeError} If `files` is empty, or two paths collide (same
 * path, or a file that is also a directory).
 */
export function buildTrees(files: readonly GitFileEntry[]): GitTreeSet {
	if (files.length === 0)
		throw new RangeError("a tree needs at least one file");
	const root: TreeNode = { files: new Map(), dirs: new Map() };
	for (const file of files) {
		const segments = file.path.split("/");
		const leaf = segments.pop() as string;
		let node = root;
		for (const segment of segments) {
			if (node.files.has(segment)) {
				throw new RangeError(`path collision at ${file.path}`);
			}
			let child = node.dirs.get(segment);
			if (!child) {
				child = { files: new Map(), dirs: new Map() };
				node.dirs.set(segment, child);
			}
			node = child;
		}
		if (node.files.has(leaf) || node.dirs.has(leaf)) {
			throw new RangeError(`path collision at ${file.path}`);
		}
		node.files.set(leaf, file);
	}
	const trees = new Map<string, GitTreeObject>();
	const emit = (node: TreeNode): string => {
		const entries: GitTreeEntry[] = [];
		for (const [name, file] of node.files) {
			entries.push({ name, mode: file.mode, sha: file.gitSha });
		}
		for (const [name, child] of node.dirs) {
			entries.push({ name, mode: "40000", sha: emit(child) });
		}
		const body = serializeTree(entries);
		const sha = objectSha("tree", body);
		if (!trees.has(sha)) trees.set(sha, { sha, body });
		return sha;
	};
	const rootSha = emit(root);
	// The root goes last even when a subtree has identical content.
	const rootTree = trees.get(rootSha) as GitTreeObject;
	trees.delete(rootSha);
	return { root: rootSha, trees: [...trees.values(), rootTree] };
}

/**
 * Serialises a commit body.
 *
 * Writes `tree`, one `parent` line per parent, `author`, `committer`, a
 * blank line and the message, as `git commit-tree` does. Dates are whole
 * seconds since the epoch followed by the `+hhmm` offset.
 */
export function serializeCommit(commit: GitCommit): Buffer {
	const lines = [`tree ${commit.tree}`];
	for (const parent of commit.parents) lines.push(`parent ${parent}`);
	lines.push(`author ${formatSignature(commit.author)}`);
	lines.push(`committer ${formatSignature(commit.committer)}`);
	return Buffer.from(`${lines.join("\n")}\n\n${commit.message}`, "utf8");
}

/**
 * Reads a commit body back into its fields.
 *
 * Headers other than `tree`, `parent`, `author` and `committer` (such as
 * `gpgsig`) are skipped. `date` loses sub-second precision.
 *
 * @throws {SyntaxError} If the body is not a well-formed commit.
 */
export function parseCommit(body: Buffer): GitCommit {
	const text = body.toString("utf8");
	const split = text.indexOf("\n\n");
	const head = split < 0 ? text : text.slice(0, split);
	const message = split < 0 ? "" : text.slice(split + 2);
	let tree: string | undefined;
	const parents: string[] = [];
	let author: GitSignature | undefined;
	let committer: GitSignature | undefined;
	for (const line of head.split("\n")) {
		// Continuation lines belong to a multi-line header such as gpgsig.
		if (line.startsWith(" ")) continue;
		const space = line.indexOf(" ");
		const key = space < 0 ? line : line.slice(0, space);
		const value = space < 0 ? "" : line.slice(space + 1);
		if (key === "tree") {
			if (!SHA_PATTERN.test(value))
				throw new SyntaxError("malformed tree line");
			tree = value;
		} else if (key === "parent") {
			if (!SHA_PATTERN.test(value))
				throw new SyntaxError("malformed parent line");
			parents.push(value);
		} else if (key === "author") {
			author = parseSignature(value);
		} else if (key === "committer") {
			committer = parseSignature(value);
		}
	}
	if (!tree || !author || !committer) {
		throw new SyntaxError("commit is missing tree, author or committer");
	}
	return { tree, parents, author, committer, message };
}

/**
 * Streams a whole object, header included, without compression.
 *
 * `content` must yield exactly `size` bytes; the sha1 of the stream is the
 * object's sha.
 */
export function objectStream(
	kind: GitObjectKind,
	size: number,
	content: Buffer | Readable,
): Readable {
	async function* chunks(): AsyncGenerator<Buffer> {
		yield objectHeader(kind, size);
		let total = 0;
		for await (const chunk of Buffer.isBuffer(content)
			? [content]
			: (content as AsyncIterable<Buffer | string>)) {
			const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			total += buf.length;
			if (total > size) throw new RangeError("object content exceeds its size");
			yield buf;
		}
		if (total !== size) {
			throw new RangeError(
				`object content has ${total} bytes, expected ${size}`,
			);
		}
	}
	return Readable.from(chunks(), { objectMode: false });
}

/**
 * Compresses an uncompressed object stream (header included) into a loose
 * object, as git stores it under `objects/xx/`: zlib deflate, in streaming.
 *
 * @example
 * looseObject(objectStream("blob", bytes.length, bytes)); // ready to serve
 */
export function looseObject(object: Readable): Readable {
	const deflate = createDeflate();
	pipeline(object, deflate, (error) => {
		if (error) deflate.destroy(error);
	});
	return deflate;
}
