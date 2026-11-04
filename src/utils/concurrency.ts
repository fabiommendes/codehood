/// Settings of a slot pool: how many slots one key may hold at once, and how
/// many all keys together may hold.
export interface SlotOptions {
	perKey: number;
	total: number;
}

/// A pool of concurrency slots keyed by string.
export interface Slots {
	/// Takes a slot for `key`, or returns `undefined` when `key` or the pool is
	/// full. The returned function gives the slot back; calling it twice is a
	/// no-op.
	acquire(key: string): (() => void) | undefined;
}

/**
 * Creates a pool that caps how many slots each key, and the pool as a whole,
 * hold at the same time.
 *
 * @example
 * const slots = createSlots({ perKey: 1, total: 2 });
 * const release = slots.acquire("ana"); // a function
 * slots.acquire("ana"); // undefined
 * release?.();
 */
export function createSlots(options: SlotOptions): Slots {
	const { perKey, total } = options;
	const held = new Map<string, number>();
	let inUse = 0;

	return {
		acquire(key) {
			const count = held.get(key) ?? 0;
			if (count >= perKey || inUse >= total) return undefined;
			held.set(key, count + 1);
			inUse++;
			let released = false;
			return () => {
				if (released) return;
				released = true;
				inUse--;
				const left = (held.get(key) ?? 1) - 1;
				if (left > 0) held.set(key, left);
				else held.delete(key);
			};
		},
	};
}
