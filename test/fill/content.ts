/**
 * The documents the fill stores in JSON columns: questions of every type in
 * the shape `QuestionData` holds them, and answers in the shape `Submission`
 * holds them.
 */
import type { Random } from "./random";

export type QuestionType =
	| "MULTIPLE_CHOICE"
	| "MULTIPLE_SELECTION"
	| "TRUE_FALSE"
	| "ESSAY"
	| "NUMERIC"
	| "SHORT_ANSWER"
	| "FILL_IN"
	| "ORDERING"
	| "CODE";

/// One answer to a question: what `Submission.payload` holds and what it is worth.
export interface Answer {
	payload: unknown;
	/// Decimal string in [0, 1].
	score: string;
	/// The answer as typed, for the types answered in a text box.
	text?: string;
	/// The text the box starts with, when `text` is set.
	base?: string;
}

export interface QuestionContent {
	type: QuestionType;
	title: string;
	stem: string;
	tags: string[];
	publicPayload: Record<string, unknown>;
	privatePayload: Record<string, unknown>;
	worker: string | null;
	attempts: number | null;
	penalty: string | null;
	/// A random answer, right or wrong.
	answer(rng: Random): Answer;
}

const WORDS = [
	"recursion",
	"calls",
	"itself",
	"until",
	"the",
	"base",
	"case",
	"returns",
	"a",
	"value",
	"without",
	"another",
	"call",
	"each",
	"step",
	"works",
	"on",
	"smaller",
	"input",
	"so",
	"stack",
	"grows",
	"and",
	"then",
	"unwinds",
	"list",
	"is",
	"empty",
	"when",
	"head",
	"tail",
	"are",
	"split",
	"function",
	"must",
	"terminate",
	"because",
	"invariant",
	"holds",
	"before",
	"after",
	"every",
	"iteration",
	"complexity",
	"linear",
	"in",
	"length",
	"of",
	"array",
	"while",
	"tree",
	"has",
	"logarithmic",
	"depth",
	"queue",
	"keeps",
	"order",
	"arrival",
	"não",
	"é",
	"função",
	"também",
];

const TOPICS = [
	"recursion",
	"loops",
	"lists",
	"trees",
	"graphs",
	"sorting",
	"complexity",
	"functions",
	"types",
	"strings",
	"queues",
	"stacks",
];

export const TAGS = TOPICS;

/** `count` words separated by spaces, capitalised and ended by a period. */
export function sentence(rng: Random, count: number): string {
	const words: string[] = [];
	for (let i = 0; i < count; i++) words.push(rng.pick(WORDS));
	const text = words.join(" ");
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Several sentences, between `min` and `max` words in all. */
export function paragraph(rng: Random, min: number, max: number): string {
	let left = rng.range(min, max);
	const parts: string[] = [];
	while (left > 0) {
		const count = Math.min(left, rng.range(5, 14));
		parts.push(sentence(rng, count));
		left -= count;
	}
	return parts.join(" ");
}

/// `count` texts that differ from each other, as the choices of a question must.
function distinct(rng: Random, count: number, make: () => string): string[] {
	const texts = new Set<string>();
	while (texts.size < count) texts.add(make());
	return rng.shuffle([...texts]);
}

/// The private choices carry the key (`score` or `correct`), the public ones do not.
function choiceIds(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `opt-${i + 1}`);
}

const ELM_FUNCTIONS: { name: string; bodies: [string, string][] }[] = [
	{
		name: "soma",
		bodies: [
			["List.foldl (+) 0 xs", "1"],
			["List.sum xs", "1"],
			["List.sum (List.filter (\\x -> x > 0) xs)", "0.67"],
			["List.length xs", "0.33"],
		],
	},
	{
		name: "maximo",
		bodies: [
			["Maybe.withDefault 0 (List.maximum xs)", "1"],
			["List.foldl max 0 xs", "0.67"],
			["Maybe.withDefault 0 (List.head xs)", "0.33"],
		],
	},
	{
		name: "conta",
		bodies: [
			["List.length xs", "1"],
			["List.foldl (\\_ n -> n + 1) 0 xs", "1"],
			["List.sum xs", "0.33"],
		],
	},
	{
		name: "pares",
		bodies: [
			["List.length (List.filter (\\x -> modBy 2 x == 0) xs)", "1"],
			["List.length (List.filter (\\x -> modBy 2 x == 1) xs)", "0.33"],
			["List.length xs // 2", "0.67"],
		],
	},
];

function codeQuestion(
	rng: Random,
	index: number,
	worker: string | null,
): QuestionContent {
	const fn = rng.pick(ELM_FUNCTIONS);
	const id = `elm-${fn.name}-${index}`;
	const header = `module Main exposing (${fn.name})\n\n\n${fn.name} : List Int -> Int\n${fn.name} xs =\n    `;
	const template = `\`\`\`elm\n${header}0\n\`\`\``;
	const stem = `[${fn.name} ${index}] Escreva a função \`${fn.name} : List Int -> Int\`. O módulo se chama \`Main\`. ${sentence(rng, 8)}`;
	const publicTest = `tests : Test\ntests =\n    describe "pre"\n        [ test "vazia" <| \\_ -> Expect.equal 0 (${fn.name} [])\n        , test "um" <| \\_ -> Expect.equal 7 (${fn.name} [ 7 ])\n        ]`;
	const imports = `import Expect\nimport Main exposing (${fn.name})\nimport Test exposing (Test, describe, test)\n\n\n`;
	const attempts = worker ? rng.pick([3, 4, 5]) : null;
	const penalty = worker ? rng.pick(["0", "0.1", "0.2"]) : null;
	return {
		type: "CODE",
		title: id,
		stem,
		tags: [],
		worker,
		attempts,
		penalty,
		publicPayload: {
			type: "code",
			id,
			stem,
			template,
			language: "elm",
			file: "Main.elm",
			publicTests: [
				{ format: "elm", text: publicTest, firstLine: 9, example: false },
			],
		},
		privatePayload: {
			id,
			stem,
			...(worker
				? { meta: { worker, attempts, penalty: Number(penalty) } }
				: {}),
			type: "code",
			language: "elm",
			file: "Main.elm",
			tests: [
				{
					format: "elm",
					text: `module Pre exposing (tests)\n\n${imports}-- mdq: [0] {public} Lista vazia e um elemento\n${publicTest}\n`,
					origin: "Pre.elm",
				},
				{
					format: "elm",
					text: `module Hidden exposing (tests)\n\n${imports}tests : Test\ntests =\n    describe "hidden"\n        [ -- mdq: [+2] Listas longas\n          test "longa" <| \\_ -> Expect.equal 55 (${fn.name} (List.range 1 10))\n        , -- mdq: [+1] Negativos\n          test "negativos" <| \\_ -> Expect.equal -3 (${fn.name} [ -1, -2 ])\n        ]\n`,
					origin: "Hidden.elm",
				},
			],
			template,
			answerKey: `\`\`\`elm\n${header}${fn.bodies[0]?.[0]}\n\`\`\``,
		},
		answer(r) {
			const [body, score] = r.pick(fn.bodies);
			const text = `${header}${body}\n`;
			return { payload: text, score, text, base: `${header}0\n` };
		},
	};
}

/**
 * A question of `type` in the shape the server stores it.
 *
 * `worker` only applies to a `CODE` question: the external worker that grades
 * it, or null when it is graded by hand.
 */
export function questionContent(
	rng: Random,
	type: QuestionType,
	index: number,
	worker: string | null,
): QuestionContent {
	if (type === "CODE") return codeQuestion(rng, index, worker);
	const topic = rng.pick(TOPICS);
	const tags = rng.chance(0.3) ? [topic, rng.pick(TOPICS)] : [topic];
	const uniqueTags = [...new Set(tags)];
	const title = `${topic.charAt(0).toUpperCase()}${topic.slice(1)} ${index}`;
	const stem = `${sentence(rng, rng.range(8, 20))}?`;
	const head = { title, stem, tags: uniqueTags };
	const common = {
		type,
		title,
		stem,
		tags: uniqueTags,
		worker: null,
		attempts: null,
		penalty: null,
	};
	switch (type) {
		case "MULTIPLE_CHOICE": {
			const ids = choiceIds(rng.range(3, 5));
			const texts = distinct(rng, ids.length, () =>
				sentence(rng, rng.range(2, 7)),
			);
			const correct = rng.pick(ids);
			return {
				...common,
				publicPayload: {
					type: "multiple-choice",
					...head,
					choices: ids.map((id, i) => ({ id, text: texts[i] })),
				},
				privatePayload: {
					...head,
					type: "multiple-choice",
					choices: ids.map((id, i) =>
						id === correct
							? { id, text: texts[i], score: 1 }
							: { id, text: texts[i] },
					),
				},
				answer(r) {
					const chosen = r.chance(0.6) ? correct : r.pick(ids);
					return { payload: chosen, score: chosen === correct ? "1" : "0" };
				},
			};
		}
		case "MULTIPLE_SELECTION":
		case "TRUE_FALSE": {
			const name = type === "TRUE_FALSE" ? "true-false" : "multiple-selection";
			const ids = choiceIds(rng.range(2, 5));
			const texts = distinct(rng, ids.length, () =>
				sentence(rng, rng.range(3, 9)),
			);
			const key = ids.map(() => rng.chance(0.5));
			return {
				...common,
				publicPayload: {
					type: name,
					...head,
					choices: ids.map((id, i) => ({ id, text: texts[i] })),
				},
				privatePayload: {
					...head,
					type: name,
					choices: ids.map((id, i) => ({
						id,
						text: texts[i],
						correct: key[i],
					})),
				},
				answer(r) {
					const marks = key.map((k) => (r.chance(0.75) ? k : !k));
					const right = marks.filter((m, i) => m === key[i]).length;
					const score = String(Math.round((right / ids.length) * 100) / 100);
					const payload =
						type === "TRUE_FALSE"
							? Object.fromEntries(ids.map((id, i) => [id, marks[i]]))
							: ids.filter((_, i) => marks[i]);
					return { payload, score };
				},
			};
		}
		case "ESSAY":
			return {
				...common,
				publicPayload: { type: "essay", ...head, content: "text" },
				privatePayload: { ...head, type: "essay", content: "text" },
				answer(r) {
					const text = r.chance(0.03) ? "" : paragraph(r, 8, 90);
					return {
						payload: text,
						score: r.pick(["0", "0.25", "0.5", "0.7", "0.8", "0.9", "1"]),
						text,
						base: "",
					};
				},
			};
		case "NUMERIC": {
			const key = rng.range(0, 500);
			return {
				...common,
				publicPayload: { type: "numeric", ...head, domain: "integer" },
				privatePayload: {
					...head,
					answer: key,
					domain: "integer",
					type: "numeric",
				},
				answer(r) {
					const value = r.chance(0.6) ? key : r.range(0, 500);
					return { payload: value, score: value === key ? "1" : "0" };
				},
			};
		}
		case "SHORT_ANSWER": {
			const key = `${rng.pick(WORDS)} ${rng.pick(WORDS)}`;
			return {
				...common,
				publicPayload: {
					type: "short-answer",
					...head,
					unmatched: "incorrect",
				},
				privatePayload: {
					...head,
					accept: [{ pattern: key }],
					type: "short-answer",
				},
				answer(r) {
					const text = r.chance(0.55)
						? key
						: `${r.pick(WORDS)} ${r.pick(WORDS)}`;
					return {
						payload: text,
						score: text === key ? "1" : "0",
						text,
						base: "",
					};
				},
			};
		}
		case "FILL_IN": {
			const [first = "", second = ""] = distinct(rng, 2, () => rng.pick(WORDS));
			const filled = `${sentence(rng, 5)} [^stop] ${rng.pick(WORDS)} [^smaller] ${rng.pick(WORDS)}.`;
			return {
				...common,
				stem: filled,
				publicPayload: {
					type: "fill-in",
					...head,
					stem: filled,
					blanks: [
						{
							id: "stop",
							type: "multiple-choice",
							choices: [
								{ id: "base", text: first },
								{ id: "recursive", text: second },
							],
						},
						{ id: "smaller", type: "short-answer", unmatched: "manual" },
					],
				},
				privatePayload: {
					...head,
					stem: filled,
					type: "fill-in",
					blanks: [
						{
							id: "stop",
							type: "multiple-choice",
							choices: [
								{ id: "base", text: first, score: 1 },
								{ id: "recursive", text: second },
							],
						},
						{ accept: [second, first], id: "smaller", type: "short-answer" },
					],
					unmatched: "manual",
				},
				answer(r) {
					const stop = r.chance(0.7) ? "base" : "recursive";
					const smaller = r.chance(0.6) ? second : r.pick(WORDS);
					const score =
						(stop === "base" ? 0.5 : 0) + (smaller === second ? 0.5 : 0);
					return { payload: { stop, smaller }, score: String(score) };
				},
			};
		}
		case "ORDERING": {
			const lines = Array.from(
				{ length: rng.range(3, 6) },
				(_, i) => [0, `${i + 1}. ${sentence(rng, 4)}`] as [number, string],
			);
			return {
				...common,
				publicPayload: {
					type: "ordering",
					...head,
					content: "text",
					unmatched: "manual",
					pool: rng.shuffle(lines),
				},
				privatePayload: {
					...head,
					type: "ordering",
					lines,
					content: "text",
					unmatched: "manual",
				},
				answer(r) {
					const right = r.chance(0.5);
					return {
						payload: right ? lines : r.shuffle(lines),
						score: right ? "1" : "0",
					};
				},
			};
		}
	}
}

/// What the worker reports for a run: how many of the four cases fail, pretests first.
export type RunOutcome = "pass" | "hidden" | "pretest";

/** A runner report of the four test cases of a code question. */
export function runnerReport(outcome: RunOutcome): Record<string, unknown> {
	const fail = (id: string, expected: string) => ({
		id,
		verdict: "fail",
		message: `Expected ${expected} but got 0`,
		expected,
		actual: "0",
	});
	const pass = (id: string) => ({ id, verdict: "pass" });
	const cases = [
		{ source: 0, line: 12, ...pass("Pre pre::vazia"), duration: 0.004 },
		{
			source: 0,
			line: 13,
			...(outcome === "pretest"
				? fail("Pre pre::um", "7")
				: pass("Pre pre::um")),
			duration: 0.003,
		},
		{ source: 1, line: 12, ...pass("Hidden hidden::longa"), duration: 0.006 },
		{
			source: 1,
			line: 14,
			...(outcome === "hidden"
				? fail("Hidden hidden::negativos", "-3")
				: pass("Hidden hidden::negativos")),
			duration: 0.004,
		},
	];
	return {
		status: "completed",
		runner: { name: "chalk-worker", version: "0.1.0", language: "elm" },
		cases,
	};
}

const GIVEN = [
	"Ana",
	"Bruno",
	"Carla",
	"Diego",
	"Elisa",
	"Fábio",
	"Gabriela",
	"Heitor",
	"Isabela",
	"João",
	"Karina",
	"Lucas",
	"Marina",
	"Nuno",
	"Olívia",
	"Paulo",
	"Rafaela",
	"Sérgio",
	"Tânia",
	"Vítor",
	"Grace",
	"Alan",
	"Barbara",
	"Edsger",
];

const FAMILY = [
	"Almeida",
	"Barbosa",
	"Cardoso",
	"Dias",
	"Esteves",
	"Ferreira",
	"Gomes",
	"Lima",
	"Mendes",
	"Nogueira",
	"Oliveira",
	"Pereira",
	"Queiroz",
	"Ribeiro",
	"Souza",
	"Teixeira",
	"Vieira",
	"Xavier",
];

/** A person's full name. */
export function personName(rng: Random): string {
	const middle = rng.chance(0.3) ? ` ${rng.pick(FAMILY)}` : "";
	return `${rng.pick(GIVEN)}${middle} ${rng.pick(FAMILY)}`;
}
