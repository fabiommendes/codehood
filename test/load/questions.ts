/**
 * The questions of the load-test exam: Elm `code` questions graded by the
 * chalk-worker, and essays that only feed the edit history.
 *
 * Every code question carries four answers, so the worker sees each outcome:
 * a correct one, one that fails a pretest, one that passes the pretests and
 * fails a hidden test, and one that does not compile.
 */

import { type CodeQuestion, parse, resolveTests } from "mdq";

export type Variant = "correct" | "failsPretest" | "failsHidden" | "noCompile";

export interface LoadCodeQuestion {
	slug: string;
	title: string;
	stem: string;
	/// The exposed function, e.g. `soma`.
	name: string;
	signature: string;
	/// `[expected, call]` pairs, in Elm.
	pretests: [string, string][];
	hidden: [string, string][];
	/// Function bodies (the lines after `name args =`), by variant.
	bodies: Record<Exclude<Variant, "noCompile">, string>;
	args: string;
}

export interface LoadEssayQuestion {
	slug: string;
	title: string;
	stem: string;
	/// What a student types, roughly.
	answer: string;
}

export const CODE_QUESTIONS: LoadCodeQuestion[] = [
	{
		slug: "load-soma",
		title: "Soma",
		stem: "Escreva `soma : List Int -> Int`, que soma os elementos da lista.",
		name: "soma",
		signature: "List Int -> Int",
		args: "xs",
		pretests: [
			["0", "soma []"],
			["7", "soma [ 7 ]"],
		],
		hidden: [
			["55", "soma (List.range 1 10)"],
			["-3", "soma [ -1, -2 ]"],
		],
		bodies: {
			correct: "List.foldl (+) 0 xs",
			failsPretest: "0",
			failsHidden: "List.sum (List.filter (\\x -> x > 0) xs)",
		},
	},
	{
		slug: "load-maximo",
		title: "Máximo",
		stem: "Escreva `maximo : List Int -> Int`, o maior elemento da lista, ou 0 se ela for vazia.",
		name: "maximo",
		signature: "List Int -> Int",
		args: "xs",
		pretests: [
			["5", "maximo [ 1, 5, 2 ]"],
			["0", "maximo []"],
		],
		hidden: [
			["-2", "maximo [ -5, -2 ]"],
			["100", "maximo (List.range 1 100)"],
		],
		bodies: {
			correct:
				"case xs of\n        [] ->\n            0\n\n        x :: rest ->\n            List.foldl max x rest",
			failsPretest: "Maybe.withDefault 0 (List.head xs)",
			failsHidden: "List.foldl max 0 xs",
		},
	},
	{
		slug: "load-conta",
		title: "Conta",
		stem: "Escreva `conta : Int -> List Int -> Int`, quantas vezes o valor aparece na lista.",
		name: "conta",
		signature: "Int -> List Int -> Int",
		args: "x xs",
		pretests: [
			["2", "conta 1 [ 1, 2, 1 ]"],
			["0", "conta 3 []"],
		],
		hidden: [
			["4", "conta 0 [ 0, 0, 0, 0 ]"],
			["0", "conta 5 [ 1, 2 ]"],
		],
		bodies: {
			correct: "List.length (List.filter (\\y -> y == x) xs)",
			failsPretest: "List.length xs",
			failsHidden: "if List.member x xs then\n        2\n\n    else\n        0",
		},
	},
	{
		slug: "load-fatorial",
		title: "Fatorial",
		stem: "Escreva `fatorial : Int -> Int`, com `fatorial 0 == 1`.",
		name: "fatorial",
		signature: "Int -> Int",
		args: "n",
		pretests: [
			["1", "fatorial 0"],
			["6", "fatorial 3"],
		],
		hidden: [
			["120", "fatorial 5"],
			["3628800", "fatorial 10"],
		],
		bodies: {
			correct:
				"if n <= 1 then\n        1\n\n    else\n        n * fatorial (n - 1)",
			failsPretest:
				"if n <= 0 then\n        0\n\n    else\n        n * fatorial (n - 1)",
			failsHidden: "if n <= 1 then\n        1\n\n    else\n        n * (n - 1)",
		},
	},
	{
		slug: "load-inverte",
		title: "Inverte",
		stem: "Escreva `inverte : List Int -> List Int`, a lista de trás para frente, sem usar `List.reverse`.",
		name: "inverte",
		signature: "List Int -> List Int",
		args: "xs",
		pretests: [
			["[ 3, 2, 1 ]", "inverte [ 1, 2, 3 ]"],
			["[]", "inverte []"],
		],
		hidden: [
			["[ 1 ]", "inverte [ 1 ]"],
			["[ 5, 4, 3, 2, 1 ]", "inverte (List.range 1 5)"],
		],
		bodies: {
			correct: "List.foldl (::) [] xs",
			failsPretest: "xs",
			failsHidden:
				"case xs of\n        [ a, b, c ] ->\n            [ c, b, a ]\n\n        _ ->\n            []",
		},
	},
	{
		slug: "load-pares",
		title: "Pares",
		stem: "Escreva `pares : List Int -> List Int`, só os elementos pares, na ordem.",
		name: "pares",
		signature: "List Int -> List Int",
		args: "xs",
		pretests: [
			["[ 2, 4 ]", "pares [ 1, 2, 3, 4 ]"],
			["[]", "pares []"],
		],
		hidden: [
			["[ -2 ]", "pares [ -2, -1 ]"],
			["[ 0 ]", "pares [ 0 ]"],
		],
		bodies: {
			correct: "List.filter (\\x -> modBy 2 x == 0) xs",
			failsPretest: "List.filter (\\x -> modBy 2 x == 1) xs",
			failsHidden: "List.filter (\\x -> x > 0 && modBy 2 x == 0) xs",
		},
	},
];

export const ESSAY_QUESTIONS: LoadEssayQuestion[] = [
	{
		slug: "load-essay-tipos",
		title: "Tipos",
		stem: "Explique a diferença entre `List Int` e `Maybe Int`, com um exemplo de uso de cada um.",
		answer:
			"Uma List Int guarda zero ou mais inteiros, em ordem, e serve para coleções como as notas de uma turma. " +
			"Um Maybe Int guarda no máximo um inteiro: Just 3 quando o valor existe e Nothing quando falta, " +
			"como no resultado de List.head, que não tem o que devolver numa lista vazia. " +
			"O compilador obriga a tratar o caso Nothing, então o programa não quebra por um valor ausente.",
	},
	{
		slug: "load-essay-recursao",
		title: "Recursão",
		stem: "Descreva como a função `soma` pode ser escrita com recursão, e por que ela termina.",
		answer:
			"A soma da lista vazia é zero, que é o caso base. Para uma lista x :: resto, a soma é x mais a soma do resto. " +
			"Cada chamada recebe uma lista menor que a anterior, então em algum momento a chamada chega à lista vazia " +
			"e para. Com foldl o acumulador evita empilhar as chamadas, o que importa em listas longas.",
	},
];

/// The module header every Elm answer starts with.
function header(question: LoadCodeQuestion): string {
	return `module Main exposing (${question.name})\n\n\n`;
}

/// The full source of the answer `variant` to `question`.
export function answerOf(question: LoadCodeQuestion, variant: Variant): string {
	if (variant === "noCompile") {
		// The correct answer cut short: a parse error the student is still typing through.
		const full = answerOf(question, "correct");
		return `${full.slice(0, Math.floor(full.length * 0.8))}\n`;
	}
	return `${header(question)}${question.name} : ${question.signature}\n${question.name} ${question.args} =\n    ${question.bodies[variant]}\n`;
}

/// The template the editor opens with.
export function templateOf(question: LoadCodeQuestion): string {
	return `${header(question)}${question.name} : ${question.signature}\n${question.name} ${question.args} =\n    Debug.todo "${question.name}"\n`;
}

function testModule(
	module: string,
	question: LoadCodeQuestion,
	cases: [string, string][],
	annotation: (index: number) => string,
	header: string,
): string {
	const items = cases
		.map(
			([expected, call], index) =>
				`${index === 0 ? "[" : ","} ${annotation(index)}test "${call}" <| \\_ -> Expect.equal (${expected}) (${call})`,
		)
		.join("\n        ");
	return [
		`module ${module} exposing (tests)`,
		"",
		"import Expect",
		`import Main exposing (${question.name})`,
		"import Test exposing (Test, describe, test)",
		"",
		"",
		header,
		"tests : Test",
		"tests =",
		`    describe "${module.toLowerCase()}"`,
		`        ${items}`,
		"        ]",
		"",
	].join("\n");
}

/// The question as the CLI would push it: mdq document with its test sources resolved.
export function codeQuestionDocument(question: LoadCodeQuestion): CodeQuestion {
	const pre = testModule(
		"Pre",
		question,
		question.pretests,
		() => "",
		"-- mdq: [0] {public} Pré-testes",
	);
	const hidden = testModule(
		"Hidden",
		question,
		question.hidden,
		() => "-- mdq: [+1] Caso escondido\n          ",
		"",
	);
	const markdown = [
		"---",
		`id: ${question.slug}`,
		"type: code",
		"language: elm",
		"file: Main.elm",
		"meta:",
		"  worker: elm-test",
		"  attempts: 4",
		"  penalty: 0.2",
		"---",
		`[${question.title}] ${question.stem}`,
		"",
		"[code]",
		"",
		"## [template]",
		"",
		"```elm",
		templateOf(question).trimEnd(),
		"```",
		"",
		"## [tests]",
		"",
		"[pré-testes](Pre.elm)",
		"",
		"[testes](Hidden.elm)",
		"",
		"## [answer-key]",
		"",
		"```elm",
		answerOf(question, "correct").trimEnd(),
		"```",
		"",
	].join("\n");
	const parsed = parse(markdown, { kind: "question" }) as CodeQuestion;
	return resolveTests(parsed, { "Pre.elm": pre, "Hidden.elm": hidden });
}
