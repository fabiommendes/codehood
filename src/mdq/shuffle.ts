import type { PublicQuestion } from "./index";

/**
 * Shuffles the pool of an ordering question in an order fixed by `seed`, and
 * returns any other question as is.
 *
 * The public form sorts the pool by text, and mdq requires the host to shuffle
 * it before a student sees it. Seeding by attempt and question gives each
 * attempt its own order and keeps it across reloads.
 *
 * @example
 * shufflePool(publicForm(question), `${attempt.publicId}:${slug}`)
 */
export function shufflePool<Q extends PublicQuestion>(
	question: Q,
	seed: string,
): Q {
	if (question.type !== "ordering") return question;
	const random = mulberry32(fnv1a(seed));
	// Sorting by a random key is a uniform shuffle when the keys are distinct.
	const pool = question.pool
		.map((line) => ({ line, key: random() }))
		.sort((a, b) => a.key - b.key)
		.map(({ line }) => line);
	return { ...question, pool };
}

/// The 32-bit FNV-1a hash of `text`, a seed for `mulberry32`.
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/// A small seeded generator of numbers in [0, 1); not for anything secret.
function mulberry32(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
