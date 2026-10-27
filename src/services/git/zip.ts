/**
 * A streaming, deterministic zip writer.
 *
 * Memory stays constant in the size of the archive: each file is read from
 * its own stream once, compressed on the way through, and followed by a data
 * descriptor, so nothing is buffered whole.
 */
import type { Readable } from "node:stream";

/// One file of an archive.
export type ZipFile = {
	/// Relative path with `/` separators, without the archive root.
	path: string;
	/// `100755` sets the executable bits in the Unix external attributes.
	mode: "100644" | "100755";
	/// Exact byte count `open()` yields.
	size: number;
	/// Opens the bytes. Called once, when the writer reaches this file.
	open: () => Readable;
};

/// Settings that apply to every entry of an archive.
export type ZipOptions = {
	/// Folder every entry is placed under, e.g. the repository slug. No slash.
	root: string;
	/// Modification time stamped on every entry, in UTC. Clamped to 1980-01-01
	/// at the earliest, the floor of the DOS date format.
	date: Date;
};

/**
 * Streams a zip archive of `files`, every entry under `<root>/`.
 *
 * Deterministic: the same files, root and date give the same bytes. Entries
 * are written sorted by path (byte order) whatever the input order, with
 * deflate compression, a fixed DOS timestamp, Unix permissions (`0644` or
 * `0755`) and no extra fields. Only files get entries; directories are
 * implied by the paths. No zip64: archives stay under 4 GiB.
 *
 * The stream fails with a `RangeError` if a file yields a byte count other
 * than its `size`, or the archive would need zip64.
 *
 * @throws {RangeError} If two files share a path.
 */
export function writeZip(
	_files: readonly ZipFile[],
	_options: ZipOptions,
): Readable {
	throw new Error("not implemented");
}
