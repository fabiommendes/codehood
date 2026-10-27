/**
 * A streaming, deterministic zip writer.
 *
 * Memory stays constant in the size of the archive: each file is read from
 * its own stream once, compressed on the way through, and followed by a data
 * descriptor, so nothing is buffered whole.
 */
import { pipeline, Readable } from "node:stream";
import { crc32, createDeflateRaw } from "node:zlib";

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
	files: readonly ZipFile[],
	options: ZipOptions,
): Readable {
	const paths = new Set<string>();
	for (const file of files) {
		if (paths.has(file.path)) {
			throw new RangeError(`duplicate zip path: ${file.path}`);
		}
		paths.add(file.path);
	}
	const sorted = files
		.map((file) => ({
			file,
			name: Buffer.from(`${options.root}/${file.path}`, "utf8"),
		}))
		.sort((a, b) => Buffer.compare(a.name, b.name));
	const { time, date } = dosDateTime(options.date);
	return Readable.from(zipChunks(sorted, time, date), { objectMode: false });
}

/// Zip format limits that this writer does not extend with zip64.
const MAX_U32 = 0xffffffff;
const MAX_U16 = 0xffff;

/// General purpose flags: bit 3 (data descriptor) and bit 11 (UTF-8 names).
const FLAGS = 0x0808;
/// Version made by (Unix) and version needed to extract (2.0).
const VERSION_MADE_BY = (3 << 8) | 20;
const VERSION_NEEDED = 20;
const METHOD_DEFLATE = 8;

type SortedEntry = { file: ZipFile; name: Buffer };

type CentralRecord = {
	name: Buffer;
	mode: ZipFile["mode"];
	crc: number;
	compressed: number;
	size: number;
	offset: number;
};

/// Converts to the DOS date and time fields, in UTC, clamped to 1980..2107.
function dosDateTime(value: Date): { time: number; date: number } {
	const floor = Date.UTC(1980, 0, 1);
	const ceiling = Date.UTC(2107, 11, 31, 23, 59, 58);
	const ms = Math.min(Math.max(value.getTime(), floor), ceiling);
	const d = new Date(ms);
	return {
		time:
			(d.getUTCHours() << 11) |
			(d.getUTCMinutes() << 5) |
			(d.getUTCSeconds() >> 1),
		date:
			((d.getUTCFullYear() - 1980) << 9) |
			((d.getUTCMonth() + 1) << 5) |
			d.getUTCDate(),
	};
}

function localHeader(name: Buffer, time: number, date: number): Buffer {
	const h = Buffer.alloc(30);
	h.writeUInt32LE(0x04034b50, 0);
	h.writeUInt16LE(VERSION_NEEDED, 4);
	h.writeUInt16LE(FLAGS, 6);
	h.writeUInt16LE(METHOD_DEFLATE, 8);
	h.writeUInt16LE(time, 10);
	h.writeUInt16LE(date, 12);
	h.writeUInt16LE(name.length, 26);
	return Buffer.concat([h, name]);
}

function dataDescriptor(crc: number, compressed: number, size: number): Buffer {
	const d = Buffer.alloc(16);
	d.writeUInt32LE(0x08074b50, 0);
	d.writeUInt32LE(crc, 4);
	d.writeUInt32LE(compressed, 8);
	d.writeUInt32LE(size, 12);
	return d;
}

function centralHeader(r: CentralRecord, time: number, date: number): Buffer {
	const h = Buffer.alloc(46);
	h.writeUInt32LE(0x02014b50, 0);
	h.writeUInt16LE(VERSION_MADE_BY, 4);
	h.writeUInt16LE(VERSION_NEEDED, 6);
	h.writeUInt16LE(FLAGS, 8);
	h.writeUInt16LE(METHOD_DEFLATE, 10);
	h.writeUInt16LE(time, 12);
	h.writeUInt16LE(date, 14);
	h.writeUInt32LE(r.crc, 16);
	h.writeUInt32LE(r.compressed, 20);
	h.writeUInt32LE(r.size, 24);
	h.writeUInt16LE(r.name.length, 28);
	const unixMode = r.mode === "100755" ? 0o100755 : 0o100644;
	h.writeUInt32LE((unixMode << 16) >>> 0, 38);
	h.writeUInt32LE(r.offset, 42);
	return Buffer.concat([h, r.name]);
}

async function* zipChunks(
	entries: SortedEntry[],
	time: number,
	date: number,
): AsyncGenerator<Buffer> {
	if (entries.length > MAX_U16) {
		throw new RangeError("too many zip entries for a non-zip64 archive");
	}
	const records: CentralRecord[] = [];
	let offset = 0;
	const emit = (chunk: Buffer): Buffer => {
		offset += chunk.length;
		if (offset > MAX_U32) {
			throw new RangeError("zip archive needs zip64");
		}
		return chunk;
	};
	for (const { file, name } of entries) {
		const start = offset;
		yield emit(localHeader(name, time, date));
		let crc = 0;
		let size = 0;
		let compressed = 0;
		const tap = async function* () {
			for await (const chunk of file.open() as AsyncIterable<Buffer | string>) {
				const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
				size += buf.length;
				if (size > file.size) {
					throw new RangeError(`${file.path} is larger than its declared size`);
				}
				crc = crc32(buf, crc);
				yield buf;
			}
			if (size !== file.size) {
				throw new RangeError(
					`${file.path} has ${size} bytes, expected ${file.size}`,
				);
			}
		};
		const deflate = createDeflateRaw();
		pipeline(Readable.from(tap(), { objectMode: false }), deflate, (error) => {
			if (error) deflate.destroy(error);
		});
		for await (const chunk of deflate) {
			compressed += chunk.length;
			yield emit(chunk);
		}
		yield emit(dataDescriptor(crc, compressed, size));
		records.push({
			name,
			mode: file.mode,
			crc,
			compressed,
			size,
			offset: start,
		});
	}
	const centralStart = offset;
	for (const record of records) {
		yield emit(centralHeader(record, time, date));
	}
	const centralSize = offset - centralStart;
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(records.length, 8);
	end.writeUInt16LE(records.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(centralStart, 16);
	yield emit(end);
}
