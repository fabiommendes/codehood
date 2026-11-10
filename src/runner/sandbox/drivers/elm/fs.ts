/**
 * The in-memory file system the Elm compiler reads and writes.
 *
 * Paths are absolute POSIX paths; relative ones are resolved against the
 * current directory. Modification times only ever grow, so the compiler
 * never mistakes a file written by a run for the one it compiled before.
 */

/// Modification time of files mounted from the cache: older than any write.
export const MOUNTED_MTIME = 1;

interface Entry {
	data: Uint8Array;
	mtime: number;
}

/** A file system held in memory, with a current directory. */
export class MemFs {
	readonly #files = new Map<string, Entry>();
	readonly #dirs = new Set<string>(["/"]);
	readonly #now: () => number;
	#clock = 0;
	cwd = "/";

	/** `now` gives the time of each write; the build passes a counter so its output is reproducible. */
	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	/** Resolves `path` against `cwd` and removes `.`, `..` and repeated slashes. */
	resolve(path: string): string {
		const full = path.startsWith("/") ? path : `${this.cwd}/${path}`;
		const parts: string[] = [];
		for (const part of full.split("/")) {
			if (!part || part === ".") continue;
			if (part === "..") parts.pop();
			else parts.push(part);
		}
		return `/${parts.join("/")}`;
	}

	/** Writes `data` at `path`, creating its directories; `mtime` defaults to now. */
	write(path: string, data: Uint8Array | string, mtime?: number): void {
		const key = this.resolve(path);
		this.mkdir(key.slice(0, key.lastIndexOf("/")) || "/");
		this.#files.set(key, {
			data: typeof data === "string" ? new TextEncoder().encode(data) : data,
			mtime: mtime ?? this.#tick(),
		});
	}

	/** The bytes at `path`, or null when it is not a file. */
	read(path: string): Uint8Array | null {
		return this.#files.get(this.resolve(path))?.data ?? null;
	}

	/** Modification time of `path`, or null when it is not a file. */
	mtime(path: string): number | null {
		return this.#files.get(this.resolve(path))?.mtime ?? null;
	}

	isFile(path: string): boolean {
		return this.#files.has(this.resolve(path));
	}

	isDir(path: string): boolean {
		return this.#dirs.has(this.resolve(path));
	}

	/** Creates `path` and its parents. */
	mkdir(path: string): void {
		let dir = this.resolve(path);
		while (dir !== "/" && !this.#dirs.has(dir)) {
			this.#dirs.add(dir);
			dir = dir.slice(0, dir.lastIndexOf("/")) || "/";
		}
	}

	/** Names of the files and directories right under `path`. */
	list(path: string): string[] {
		const dir = this.resolve(path);
		const prefix = dir === "/" ? "/" : `${dir}/`;
		const names = new Set<string>();
		for (const key of [...this.#files.keys(), ...this.#dirs]) {
			if (key.startsWith(prefix) && key !== dir) {
				names.add(key.slice(prefix.length).split("/")[0] ?? "");
			}
		}
		names.delete("");
		return [...names].sort();
	}

	remove(path: string): void {
		this.#files.delete(this.resolve(path));
	}

	/** Removes `path` and everything under it. */
	removeTree(path: string): void {
		const dir = this.resolve(path);
		for (const key of [...this.#files.keys()]) {
			if (key === dir || key.startsWith(`${dir}/`)) this.#files.delete(key);
		}
		for (const key of [...this.#dirs]) {
			if (key === dir || key.startsWith(`${dir}/`)) this.#dirs.delete(key);
		}
	}

	/** Every file under `path`, by absolute path. */
	filesUnder(path: string): Map<string, Uint8Array> {
		const dir = this.resolve(path);
		const out = new Map<string, Uint8Array>();
		for (const [key, entry] of this.#files) {
			if (key.startsWith(`${dir}/`)) out.set(key, entry.data);
		}
		return out;
	}

	/// A time later than every one handed out before.
	#tick(): number {
		this.#clock = Math.max(this.#now(), this.#clock + 1);
		return this.#clock;
	}
}
