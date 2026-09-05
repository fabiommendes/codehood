import { type Public, publicRepresentation } from "./public";
import type * as schema from "./schemas-generated";
import {
	type Answer,
	type AnswerKey,
	answerKey,
	type Scored,
	score,
} from "./scoring";

export type {
	Answer,
	AnswerKey,
	QuestionResult,
	QuestionType,
} from "./scoring";

/**
 * The Question type.
 *
 * Wraps the raw validated schema.Question objects, and provides convenient methods
 * and algorithms.
 */
export class Question<Q extends schema.Question> {
	get type(): Q["type"] {
		return this.data.type;
	}

	constructor(public readonly data: Q) {}

	/**
	 * Score the schema Question against the given answer.
	 *
	 * Returns a number between 0 and 1, where 1 is a perfect score.
	 */
	score(response: Answer<Q["type"]>): Scored {
		// biome-ignore lint/suspicious/noExplicitAny: hard to statically type this due to dynamic key access, hence we check the output to avoid code drift
		return this.dispatch(score, (fn) => fn(response as any, this.data as any));
	}

	/**
	 * Get a public representation of the question.
	 *
	 * This strips any sensitive information that can identify the correct
	 * answer or other private data.
	 */
	toPublic(): Public<Q> {
		return this.dispatch(
			publicRepresentation,
			// biome-ignore lint/suspicious/noExplicitAny: same dynamic dispatch, and the table's union return has to be narrowed back to this question's own type
			(fn) => fn(this.data as any) as Public<Q>,
		);
	}

	/**
	 * What a full-credit answer to this question looks like.
	 *
	 * Never send this to a student while their answer still counts: the public
	 * representation exists precisely to leave it out.
	 */
	answerKey(): AnswerKey<Q["type"]> {
		return this.dispatch(
			answerKey,
			// biome-ignore lint/suspicious/noExplicitAny: same dynamic dispatch, and the table's union return has to be narrowed back to this question's own type
			(fn) => fn(this.data as any) as AnswerKey<Q["type"]>,
		);
	}

	/**
	 * Look up this question's type in a per-type implementation table and apply
	 * it, turning a type the table does not cover into an error that names the
	 * missing function rather than an `undefined` that travels.
	 */
	private dispatch<T, F>(table: Record<string, F>, apply: (fn: F) => T): T {
		const key = camelCase(this.type);
		const fn = table[key];

		if (fn === undefined)
			throw new Error(
				`Question type ${this.type} is not implemented. Add a "${key}" entry to the corresponding table in src/mdq/.`,
			);

		return apply(fn);
	}
}

function camelCase(str: string): string {
	return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}
