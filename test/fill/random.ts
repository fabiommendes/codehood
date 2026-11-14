/// Alphabet of the tokens the server generates for public ids and secrets.
const URL_SAFE =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const HEX = "0123456789abcdef";

/** A seeded pseudo-random source: the same seed gives the same sequence. */
export class Random {
	#state: number;

	constructor(seed: number) {
		this.#state = seed >>> 0 || 0x9e3779b9;
	}

	/** A float in [0, 1), from mulberry32. */
	next(): number {
		this.#state = (this.#state + 0x6d2b79f5) >>> 0;
		let t = this.#state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** An integer in [0, n). */
	int(n: number): number {
		return Math.floor(this.next() * n);
	}

	/** An integer in [min, max], both included. */
	range(min: number, max: number): number {
		return min + this.int(max - min + 1);
	}

	chance(probability: number): boolean {
		return this.next() < probability;
	}

	/**
	 * One element of a non-empty list.
	 *
	 * @throws Error when the list is empty.
	 */
	pick<T>(items: readonly T[]): T {
		const item = items[this.int(items.length)];
		if (item === undefined) throw new Error("pick from an empty list");
		return item;
	}

	/** One value, each with the probability of its weight over the total. */
	weighted<T>(options: readonly (readonly [T, number])[]): T {
		let total = 0;
		for (const [, weight] of options) total += weight;
		let roll = this.next() * total;
		for (const [value, weight] of options) {
			roll -= weight;
			if (roll < 0) return value;
		}
		return this.pick(options)[0];
	}

	/** The number of failures before a success of probability `p`: 0 most often, with a long tail. */
	geometric(p: number): number {
		return Math.floor(Math.log(1 - this.next()) / Math.log(1 - p));
	}

	/** A copy of the list in random order. */
	shuffle<T>(items: readonly T[]): T[] {
		const copy = [...items];
		for (let i = copy.length - 1; i > 0; i--) {
			const j = this.int(i + 1);
			const a = copy[i] as T;
			copy[i] = copy[j] as T;
			copy[j] = a;
		}
		return copy;
	}

	/** At most `count` distinct elements, in random order. */
	sample<T>(items: readonly T[], count: number): T[] {
		if (count >= items.length) return this.shuffle(items);
		const taken = new Set<number>();
		const out: T[] = [];
		while (out.length < count) {
			const index = this.int(items.length);
			if (taken.has(index)) continue;
			taken.add(index);
			out.push(items[index] as T);
		}
		return out;
	}

	/** `length` URL-safe characters. */
	token(length: number): string {
		let out = "";
		for (let i = 0; i < length; i++) out += URL_SAFE[this.int(64)];
		return out;
	}

	/** `length` lowercase hexadecimal characters. */
	hex(length: number): string {
		let out = "";
		for (let i = 0; i < length; i++) out += HEX[this.int(16)];
		return out;
	}
}
