/**
 * Git object names and encodings, computed without a git binary or a
 * repository on disk.
 *
 * Everything here works on values: bytes in, bytes or shas out. The one
 * exception is {@link looseObject}, which transforms a stream it is handed
 * and never opens a file itself.
 */
import type { Readable } from "node:stream";

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

/**
 * The header git prepends to an object body before hashing and compressing
 * it: `"<kind> <size>\0"`.
 *
 * @example
 * objectHeader("blob", 5).toString("latin1"); // "blob 5\0"
 */
export function objectHeader(_kind: GitObjectKind, _size: number): Buffer {
	throw new Error("not implemented");
}

/**
 * The sha1 git gives an object of `kind` whose body is `body`.
 *
 * Hashes the header followed by the body, as `git hash-object -t <kind>`.
 */
export function objectSha(_kind: GitObjectKind, _body: Buffer): string {
	throw new Error("not implemented");
}

/**
 * The sha1 git gives a file with these bytes, as `git hash-object`.
 *
 * @example
 * blobSha(Buffer.alloc(0)); // "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"
 */
export function blobSha(_bytes: Buffer): string {
	throw new Error("not implemented");
}

/**
 * Orders two tree entries the way git sorts a tree.
 *
 * Names compare byte by byte, with a subtree compared as if its name ended
 * in `/`, so the files `a-b` and `a.txt` and the directory `a` sort as
 * `a-b`, `a.txt`, `a`.
 */
export function compareTreeEntries(_a: GitTreeEntry, _b: GitTreeEntry): number {
	throw new Error("not implemented");
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
export function serializeTree(_entries: readonly GitTreeEntry[]): Buffer {
	throw new Error("not implemented");
}

/**
 * Reads a tree body back into its entries, in stored order.
 *
 * @throws {SyntaxError} If the body is not a well-formed tree.
 */
export function parseTree(_body: Buffer): GitTreeEntry[] {
	throw new Error("not implemented");
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
export function buildTrees(_files: readonly GitFileEntry[]): GitTreeSet {
	throw new Error("not implemented");
}

/**
 * Serialises a commit body.
 *
 * Writes `tree`, one `parent` line per parent, `author`, `committer`, a
 * blank line and the message, as `git commit-tree` does. Dates are whole
 * seconds since the epoch followed by the `+hhmm` offset.
 */
export function serializeCommit(_commit: GitCommit): Buffer {
	throw new Error("not implemented");
}

/**
 * Reads a commit body back into its fields.
 *
 * Headers other than `tree`, `parent`, `author` and `committer` (such as
 * `gpgsig`) are skipped. `date` loses sub-second precision.
 *
 * @throws {SyntaxError} If the body is not a well-formed commit.
 */
export function parseCommit(_body: Buffer): GitCommit {
	throw new Error("not implemented");
}

/**
 * Streams a whole object, header included, without compression.
 *
 * `content` must yield exactly `size` bytes; the sha1 of the stream is the
 * object's sha.
 */
export function objectStream(
	_kind: GitObjectKind,
	_size: number,
	_content: Buffer | Readable,
): Readable {
	throw new Error("not implemented");
}

/**
 * Compresses an uncompressed object stream (header included) into a loose
 * object, as git stores it under `objects/xx/`: zlib deflate, in streaming.
 *
 * @example
 * looseObject(objectStream("blob", bytes.length, bytes)); // ready to serve
 */
export function looseObject(_object: Readable): Readable {
	throw new Error("not implemented");
}
