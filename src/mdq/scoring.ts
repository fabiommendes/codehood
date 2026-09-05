import { resolveChoiceIds } from "./choices";
import { blankPatterns, fillInBlanks } from "./fill-in";
import {
	formatNumericInput,
	parseNumericInput,
	withinTolerance,
} from "./numeric";
import type * as schema from "./schemas-generated";
import {
	acceptPatterns,
	matchedFeedback,
	matchesPattern,
	parsePattern,
	patternParts,
} from "./short-answer";

export type QuestionType = schema.Question["type"];

export type EssayAnswer = { essay: string };
/**
 * The number the student submitted, or `null` when they left the box empty or
 * typed something that is not a number at all.
 */
export type NumericAnswer = { value: number | null };
/** The text the student typed into the short-answer box. */
export type ShortAnswerAnswer = { text: string };
export type MultipleChoiceAnswer = { choice: string };
export type MultipleSelectionAnswer = { choices: Set<string> };
/**
 * What the student judged each statement to be. A statement with no entry was
 * abstained, which true/false grading treats as neither right nor wrong.
 */
export type TrueFalseAnswer = { answers: Map<string, boolean> };
/**
 * What the student put in each blank, keyed by blank id: a choice id for a
 * choice blank, and the raw text they typed for the other two.
 *
 * One uniform string rather than a per-kind union, because that is what the
 * controls hand over — a numeric blank has to keep its raw text anyway, or a
 * half-typed `3.` snaps back — and because unlike the `Set` and `Map` the
 * other keys use, it survives `JSON.stringify`. A blank with no entry, or one
 * that is empty after trimming, was left unanswered.
 */
export type FillInAnswer = { blanks: Record<string, string> };

/** What a student submits for a question of type `T`. */
export type Answer<T extends QuestionType> = T extends "essay"
	? EssayAnswer
	: T extends "numeric"
		? NumericAnswer
		: T extends "short-answer"
			? ShortAnswerAnswer
			: T extends "multiple-choice"
				? MultipleChoiceAnswer
				: T extends "multiple-selection"
					? MultipleSelectionAnswer
					: T extends "true-false"
						? TrueFalseAnswer
						: T extends "fill-in"
							? FillInAnswer
							: never;

/**
 * What a full-credit answer to a question of type `T` looks like.
 *
 * Deliberately shaped like `Answer<T>` rather than like the question: a review
 * screen compares the two, and a key in some third shape would make every
 * comparison its own special case. Multiple choice is the exception, and is a
 * list rather than a single id because choices can tie for the best score.
 */
export type AnswerKey<T extends QuestionType> = T extends "essay"
	? string
	: T extends "numeric"
		? number
		: T extends "short-answer"
			? string[]
			: T extends "multiple-choice"
				? string[]
				: T extends "multiple-selection"
					? Set<string>
					: T extends "true-false"
						? Map<string, boolean>
						: T extends "fill-in"
							? Record<string, string[]>
							: never;

/**
 * How choices that declare no score of their own are graded.
 *
 * Defined by mdq.spec (`docs/question-types/multiple-choice.md`, "Grading"),
 * but not yet a field in `public/mdq.schema.json`, so questions cannot carry
 * one until the schema is regenerated. Until then every question is graded
 * with the spec's default.
 */
export type GradingStrategy = "partial" | "all-or-nothing" | "symmetric";

export const DEFAULT_GRADING: GradingStrategy = "symmetric";

/**
 * The least a value needs to be scored by multiple-choice's rules: a list of
 * choices, and the strategy that prices the ones declaring no score.
 *
 * A `FillInChoiceBlank` satisfies it unchanged, which is what "graded exactly
 * like a multiple-choice question" is worth in the type system.
 */
export type ChoiceScored = Pick<schema.MultipleChoice, "choices"> & {
	grading?: GradingStrategy;
};

/** Feedback the question attaches to one specific choice. */
export type ChoiceFeedback = { id: string; feedback: string };

/**
 * The result from scoring an answer.
 */
export type Scored = {
	/** A number between 0 and 1, or -1 and 0, if it represents a penalty. */
	score: number;

	/** Optional feedback message for the answer as a whole. */
	feedback?: string;

	/**
	 * The score is provisional because nobody has graded the answer yet.
	 *
	 * Only manually graded types set it. It matters because `score: 0` is
	 * already a verdict — an essay a human read and marked worthless scores 0
	 * too — so a review screen needs to tell "not yet read" from "read and
	 * worth nothing".
	 */
	pending?: boolean;

	/**
	 * Feedback for individual choices, in the order they appear in the
	 * document. Present but empty when the type has per-choice feedback and the
	 * student earned none of it — "you got everything right" and "this question
	 * has no feedback" are not the same thing.
	 */
	choices?: ChoiceFeedback[];

	/**
	 * What each answered blank scored, keyed by blank id. Only `fill-in` sets
	 * it.
	 *
	 * A single badge is the one thing a sentence full of separate answers must
	 * not be reduced to: a student who filled three blanks of four needs to see
	 * which one cost them, and no view can work that out from the public half,
	 * where a numeric blank's tolerance and a short answer's regexes are
	 * deliberately absent. Blanks left empty are missing from the map, so they
	 * draw no mark rather than a cross.
	 */
	blanks?: Record<string, number>;
};

/**
 * A scored answer as a view renders it: the score, and the key it is measured
 * against when the student is allowed to see one.
 *
 * `correct` is separate from the question payload on purpose — a component
 * given only `Public<Q>` cannot leak an answer key it was never handed, and an
 * exam still open for review simply omits it.
 */
export interface QuestionResult<T extends QuestionType = QuestionType>
	extends Scored {
	/** From `Question#answerKey()`. Absent while the key is withheld. */
	correct?: AnswerKey<T>;
}

/**
 * Plain object with all the scoring logic for the different question types.
 */
export const score = {
	/**
	 * Essays are graded by a human, so scoring one automatically produces no
	 * score at all — only a placeholder flagged `pending`, whatever the student
	 * wrote.
	 */
	essay(_response: EssayAnswer, _question: schema.Essay): Scored {
		return { score: 0, pending: true };
	},

	/**
	 * In numeric questions the grade is binary: a response the tolerance admits
	 * scores 1, and everything else scores 0.
	 *
	 * mdq.spec gives numeric questions no `grading` field — being close is worth
	 * nothing, and widening the tolerance is how an author expresses leniency —
	 * so no strategy is consulted.
	 */
	numeric(response: NumericAnswer, question: schema.Numeric): Scored {
		if (response.value === null) return { score: 0 };
		return { score: withinTolerance(response.value, question) ? 1 : 0 };
	},

	/**
	 * In short-answer questions the score is binary, and what varies is how much
	 * of the grading is automatic.
	 *
	 * A response matching an accept pattern is correct, one matching a reject
	 * pattern is incorrect, and a response matching neither is settled only when
	 * the question lists no reject patterns at all — an absent reject list
	 * carries an implicit trailing wildcard, and writing the list out replaces
	 * that wildcard with whatever it actually lists. Everything else is
	 * `pending`, which is to say the instructor's.
	 *
	 * Accept is consulted first because mdq.spec makes it win over reject when
	 * both match.
	 */
	shortAnswer(
		response: ShortAnswerAnswer,
		question: schema.ShortAnswer,
	): Scored {
		if (question.openEnded) return { score: 0, pending: true };

		const accept = acceptPatterns(question);
		if (
			accept.some((entry) =>
				matchesPattern(
					response.text,
					parsePattern(patternParts(entry).pattern),
				),
			)
		) {
			return { score: 1, feedback: matchedFeedback(response.text, accept) };
		}

		const reject = question.reject;
		if (reject === undefined) {
			// No reject list at all: nothing falls through, and a question with no
			// accept patterns either has nothing to grade against.
			return accept.length === 0 ? { score: 0, pending: true } : { score: 0 };
		}

		if (
			reject.some((entry) =>
				matchesPattern(
					response.text,
					parsePattern(patternParts(entry).pattern),
				),
			)
		) {
			return { score: 0, feedback: matchedFeedback(response.text, reject) };
		}

		// Matched neither list, and the question replaced its implicit wildcard
		// with one that does not cover this. Only a human can settle it.
		return { score: 0, pending: true };
	},

	/**
	 * In multiple-choice questions, the score is the one declared by the
	 * selected choice, or the grading strategy's value for a choice that
	 * declares none.
	 *
	 * The result is never clamped: a negative score survives the question
	 * untouched, and whether it survives into the exam total is the exam's
	 * `penalty` policy to decide.
	 */
	multipleChoice(
		response: MultipleChoiceAnswer,
		question: schema.MultipleChoice,
	): Scored {
		const index = resolveChoiceIds(question.choices).indexOf(response.choice);

		// An answer naming a choice that is not there — a stale client, or a
		// question edited after it was served — is worth nothing, not an
		// exception thrown in the middle of grading a whole exam.
		if (index === -1) return { score: 0 };

		const choice = question.choices[index];
		return {
			score: choiceScores(question)[index],
			feedback: choice.feedback,
		};
	},

	/**
	 * In multiple-selection questions, every choice is judged — ticking a
	 * correct one and leaving an incorrect one alone both count — and the
	 * grading strategy turns that count into a score.
	 *
	 * Feedback comes back only for the choices judged wrongly, in document
	 * order, which is why a choice the student never ticked can produce some:
	 * leaving a correct answer unticked asserts that it is false.
	 */
	multipleSelection(
		response: MultipleSelectionAnswer,
		question: schema.MultipleSelection,
	): Scored {
		const ids = resolveChoiceIds(question.choices);

		// An id in the response that no choice claims is ignored rather than
		// counted: it can only come from a stale client, and letting it move the
		// score would grade a choice that does not exist.
		const judged = question.choices.map(
			(choice, index) =>
				response.choices.has(ids[index]) === (choice.correct ?? false),
		);

		const right = judged.filter(Boolean).length;
		const total = judged.length;

		return {
			score: selectionScore(grading(question), right, total),
			choices: question.choices.flatMap((choice, index) =>
				!judged[index] && choice.feedback !== undefined
					? [{ id: ids[index], feedback: choice.feedback }]
					: [],
			),
		};
	},

	/**
	 * In true/false questions each statement is marked true, marked false, or
	 * abstained, and only the marked ones move the score.
	 *
	 * Feedback comes back for the statements marked wrongly and for the ones
	 * left unjudged, in document order — mdq.spec includes abstentions
	 * deliberately, since a student who skipped a statement is who the
	 * explanation is written for.
	 */
	trueFalse(response: TrueFalseAnswer, question: schema.TrueFalse): Scored {
		const ids = resolveChoiceIds(question.choices);

		// Three buckets, not two: an id absent from the map was abstained, which
		// is not the same as marking it false.
		const verdicts = question.choices.map((choice, index) => {
			const marked = response.answers.get(ids[index]);
			if (marked === undefined) return "abstained" as const;
			return marked === (choice.correct ?? false) ? "right" : "wrong";
		});

		const right = verdicts.filter((v) => v === "right").length;
		const wrong = verdicts.filter((v) => v === "wrong").length;

		return {
			score: trueFalseScore(grading(question), right, wrong, verdicts.length),
			choices: question.choices.flatMap((choice, index) =>
				verdicts[index] !== "right" && choice.feedback !== undefined
					? [{ id: ids[index], feedback: choice.feedback }]
					: [],
			),
		};
	},

	/**
	 * In fill-in questions every blank is graded by its own type's rules, and
	 * the question's strategy combines the results.
	 *
	 * The three blank kinds are "graded exactly like" the standalone types the
	 * generated schema names, so a choice blank goes through `choiceScores` —
	 * per-choice scores and all — and the numeric and short-answer blanks stay
	 * binary. What the strategy then sees is a verdict per blank: right, wrong,
	 * or never filled in.
	 *
	 * Only the blanks the stem refers to take part. A blank nothing refers to
	 * is drawn nowhere, and charging a student for a control they never saw
	 * would be charging them for the author's typo.
	 */
	fillIn(response: FillInAnswer, question: schema.FillIn): Scored {
		const blanks = fillInBlanks(question);
		const grades = blanks.map((blank) =>
			gradeBlank(blank, response.blanks[blank.id]),
		);

		return {
			score: fillInScore(grading(question), grades),
			blanks: Object.fromEntries(
				blanks.flatMap((blank, index) =>
					grades[index].verdict === "unanswered"
						? []
						: [[blank.id, grades[index].score] as const],
				),
			),
			// Keyed by blank rather than by choice: a blank is what identifies a
			// spot in the stem, and two blanks may well both offer a choice
			// called "yes".
			choices: blanks.flatMap((blank, index) =>
				grades[index].feedback !== undefined
					? [{ id: blank.id, feedback: grades[index].feedback }]
					: [],
			),
		};
	},
} as const;

/** How one blank came out: what it scored, and whether it was filled in at all. */
export interface BlankGrade {
	score: number;
	verdict: "right" | "wrong" | "unanswered";
	feedback?: string;
}

/**
 * Grade one blank against what the student put in it.
 *
 * The verdict is not derivable from the score, which is why both come back: 0
 * is what a wrong numeric blank scores and also what an empty one scores, and
 * the two strategies that penalise disagree about them.
 */
export function gradeBlank(
	blank: schema.FillInBlank,
	response: string | undefined,
): BlankGrade {
	const text = (response ?? "").trim();

	switch (blank.type) {
		case "multiple-choice": {
			const index = resolveChoiceIds(blank.choices).indexOf(text);
			// A choice id no blank claims can only come from a stale client, so it
			// is treated as nothing picked rather than as a wrong pick.
			if (index === -1) return { score: 0, verdict: "unanswered" };

			const score = choiceScores(blank)[index];
			return {
				score,
				verdict: score > 0 ? "right" : "wrong",
				feedback: blank.choices[index].feedback,
			};
		}

		case "numeric": {
			if (text === "") return { score: 0, verdict: "unanswered" };

			// Unlike `score.numeric`, text that is not a number at all is wrong
			// rather than absent: fill-in keeps the raw text, so it can tell an
			// empty box from a box holding "about ten".
			const value = parseNumericInput(text);
			const right = value !== null && withinTolerance(value, blank);
			return { score: right ? 1 : 0, verdict: right ? "right" : "wrong" };
		}

		case "short-answer": {
			if (text === "") return { score: 0, verdict: "unanswered" };

			const right = blankPatterns(blank).some((pattern) =>
				matchesPattern(text, parsePattern(pattern)),
			);
			return { score: right ? 1 : 0, verdict: right ? "right" : "wrong" };
		}
	}
}

/**
 * Combine the blank grades into the question's score, per mdq.spec's three
 * strategies, normalized by the number of blanks.
 *
 * mdq.spec writes fill-in's grading in multiple-selection's vocabulary ("each
 * correct blank *ticked*"), which no numeric or short-answer blank has. Read
 * here, and argued in `dev/specs/to-do/question-fill-in.md`, as: an empty blank
 * is the unticked one, and a filled blank is right or wrong. `all-or-nothing`
 * counts an empty blank as a mistake, which is what fill-in's prose says and
 * where it differs from true/false's.
 *
 * Nothing is clamped: a negative total survives the question, and whether it
 * survives into the exam total is the exam's `penalty` policy.
 */
function fillInScore(
	strategy: GradingStrategy,
	grades: readonly BlankGrade[],
): number {
	if (grades.length === 0) return 0;

	const total = (contribution: (grade: BlankGrade) => number): number =>
		grades.reduce((sum, grade) => sum + contribution(grade), 0) /
		grades.length;

	switch (strategy) {
		case "partial":
			return total((grade) => (grade.verdict === "right" ? grade.score : 0));
		case "all-or-nothing":
			return grades.every((grade) => grade.verdict === "right")
				? total((grade) => grade.score)
				: 0;
		case "symmetric":
			// A wrong blank costs the flat point the prose names, unless its
			// author priced that particular wrong answer themselves — which is
			// where mdq.spec's "a score defined in the body overrides the grading
			// strategy" lands for a choice blank.
			return total((grade) => {
				if (grade.verdict === "unanswered") return 0;
				if (grade.verdict === "right") return grade.score;
				return grade.score < 0 ? grade.score : -1;
			});
	}
}

/**
 * Turn the marked-right, marked-wrong and abstained counts into a score, per
 * mdq.spec's three strategies.
 *
 * `all-or-nothing` here means "no mistakes", not "everything answered": a
 * wrong mark zeroes the question, but abstaining is not a mistake, so a
 * student who marks only what they know keeps credit for it.
 */
function trueFalseScore(
	strategy: GradingStrategy,
	right: number,
	wrong: number,
	total: number,
): number {
	if (total === 0) return 0;

	switch (strategy) {
		case "partial":
			return right / total;
		case "all-or-nothing":
			return wrong > 0 ? 0 : right / total;
		case "symmetric":
			return (right - wrong) / total;
	}
}

/**
 * Turn "`right` of `total` choices judged correctly" into a score, per
 * mdq.spec's three strategies.
 */
function selectionScore(
	strategy: GradingStrategy,
	right: number,
	total: number,
): number {
	if (total === 0) return 0;

	switch (strategy) {
		case "partial":
			return right / total;
		case "all-or-nothing":
			return right === total ? 1 : 0;
		case "symmetric":
			// Right minus wrong, over the total: the wrong count is `total - right`.
			return (2 * right - total) / total;
	}
}

/**
 * The scores every choice of a question is worth, in order, with the grading
 * strategy already applied to the choices that declare none.
 */
export function choiceScores(question: ChoiceScored): number[] {
	const declared = question.choices.map((choice) => choice.score);
	const unspecified = declared.filter((s) => s === undefined).length;
	const fallback =
		grading(question) === "symmetric"
			? symmetricScore(declared, unspecified)
			: 0;

	return declared.map((s) => s ?? fallback);
}

/**
 * Plain object with the answer key of each question type: the ids of the
 * choices a student is meant to pick.
 */
export const answerKey = {
	/**
	 * The model answer, or `""` when the question declares none.
	 *
	 * Unlike the choice types, an empty key here is not a real key: the schema
	 * forbids a blank `answerKey`, so `""` can only mean the field was absent.
	 */
	essay(question: schema.Essay): AnswerKey<"essay"> {
		return question.answerKey ?? "";
	},

	/**
	 * The choices worth the most, as long as the most is worth something.
	 *
	 * Not `score === 1`: a question whose best choice is worth 0.8 is
	 * well-formed, and marking nothing correct on it would be a lie.
	 */
	multipleChoice(question: ChoiceScored): AnswerKey<"multiple-choice"> {
		const scores = choiceScores(question);
		const best = Math.max(...scores);
		if (best <= 0) return [];

		const ids = resolveChoiceIds(question.choices);
		return ids.filter((_, index) => scores[index] === best);
	},

	/** The declared value, which the tolerance is measured around. */
	numeric(question: schema.Numeric): AnswerKey<"numeric"> {
		return question.answer;
	},

	/**
	 * The literal answers, with their delimiters removed.
	 *
	 * Regexes and wildcards are dropped: a review screen puts this in front of a
	 * student under a heading like "Accepted answers", and `/[Bb]ras[íi]lia/i`
	 * is a grading rule rather than an answer anyone can read. A regex-only
	 * question therefore has an empty key, meaning "nothing to show" rather than
	 * "nothing is correct".
	 */
	shortAnswer(question: schema.ShortAnswer): AnswerKey<"short-answer"> {
		return acceptPatterns(question).flatMap((entry) => {
			const parsed = parsePattern(patternParts(entry).pattern);
			return parsed.kind === "plain" || parsed.kind === "exact"
				? [parsed.text]
				: [];
		});
	},

	/** The choices marked `correct`, which is every choice the student should tick. */
	multipleSelection(
		question: schema.MultipleSelection,
	): AnswerKey<"multiple-selection"> {
		const ids = resolveChoiceIds(question.choices);
		return new Set(ids.filter((_, index) => question.choices[index].correct));
	},

	/** How each statement should be judged, keyed by its id. */
	trueFalse(question: schema.TrueFalse): AnswerKey<"true-false"> {
		const ids = resolveChoiceIds(question.choices);
		return new Map(
			question.choices.map((choice, index) => [
				ids[index],
				choice.correct ?? false,
			]),
		);
	},

	/**
	 * The acceptable spellings of each referenced blank, keyed by blank id.
	 *
	 * Each kind contributes what its own key contributes: a choice blank the
	 * ids of the choices worth the most, a short-answer blank its literal
	 * patterns with the delimiters removed, and a numeric blank its declared
	 * answer. Ids rather than text for the choice blank, so the key lines up
	 * with the answer it is compared against; the view holds the public choices
	 * and maps one back.
	 *
	 * An empty list means "nothing to show" — a regex-only blank — rather than
	 * "nothing is correct".
	 */
	fillIn(question: schema.FillIn): AnswerKey<"fill-in"> {
		return Object.fromEntries(
			fillInBlanks(question).map((blank) => [blank.id, blankKey(blank)]),
		);
	},
} as const;

/** The spellings of one blank that a review screen can put in front of a student. */
function blankKey(blank: schema.FillInBlank): string[] {
	switch (blank.type) {
		case "multiple-choice":
			return answerKey.multipleChoice(blank);
		case "numeric":
			return [formatNumericInput(blank.answer)];
		case "short-answer":
			return blankPatterns(blank).flatMap((pattern) => {
				const parsed = parsePattern(pattern);
				return parsed.kind === "plain" || parsed.kind === "exact"
					? [parsed.text]
					: [];
			});
	}
}

/**
 * The value an unspecified choice is worth under the `symmetric` strategy: the
 * one that makes the average score of picking at random exactly zero, clamped
 * to `[-1, 0]` so a strategy never turns an unmarked choice into a reward.
 */
function symmetricScore(
	declared: readonly (number | undefined)[],
	unspecified: number,
): number {
	if (unspecified === 0) return 0;
	const total = declared.reduce<number>((sum, s) => sum + (s ?? 0), 0);
	return Math.min(0, Math.max(-1, -total / unspecified));
}

/** The question's grading strategy, defaulting to the spec's `symmetric`. */
function grading(
	question:
		| ChoiceScored
		| schema.MultipleSelection
		| schema.TrueFalse
		| schema.FillIn,
): GradingStrategy {
	// `grading` is specified by mdq.spec but absent from the generated schema,
	// so it is read defensively and this cast goes away with the next
	// `pnpm run question-models`.
	const declared = (question as { grading?: GradingStrategy }).grading;
	return declared ?? DEFAULT_GRADING;
}
