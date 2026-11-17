/// The mdq documents behind each mockup, built from the fixtures so the statement and the key never drift from the numbers.

import type { QuestionDocument } from "@/mdq";
import {
	fillIn,
	multipleChoice,
	multipleSelection,
	numeric,
	ordering,
	shortAnswer,
	trueFalse,
} from "@/mdq/fixtures";
import type { Fixture } from "./_data";

const LETTERS = "abcde";

/// The question document of a fixture, keyed by its slug.
export function docOf(q: Fixture): QuestionDocument {
	const common = { id: q.slug, title: q.title, stem: q.statement };
	switch (q.slug) {
		case "quicksort-pior-caso":
			return multipleChoice({
				...common,
				choices: q.key.map((k, i) => ({
					id: LETTERS[i] as string,
					text: k.text.slice(3),
					score: k.ok ? 1 : 0,
				})),
			});
		case "bst-propriedades":
			return multipleSelection({
				...common,
				choices: q.key.map((k, i) => ({
					id: LETTERS[i] as string,
					text: k.text.slice(3),
					correct: k.ok === true,
				})),
			});
		case "http-verdadeiro-falso":
			return trueFalse({
				...common,
				choices: q.key.map((k, i) => ({
					id: `claim-${i + 1}`,
					text: k.text.replace(/^\d+\. /, ""),
					correct: k.ok === true,
				})),
			});
		case "queda-livre":
			return numeric({
				...common,
				answer: 2.02,
				unit: "s",
				tolerance: { absolute: 0.02 },
			});
		case "tecnica-memoizacao":
			return shortAnswer({
				...common,
				accept: ["programação dinâmica", "pd", "dp"],
				unmatched: "manual",
			});
		case "soma-lacunas":
			return fillIn({
				...common,
				stem: "Na função soma, inicialize total com [^total], percorra [^iter] e acumule com total [^op] x.",
				blanks: [
					{ id: "total", type: "short-answer", accept: ["0"] },
					{ id: "iter", type: "short-answer", accept: ["xs"] },
					{ id: "op", type: "short-answer", accept: ["+="] },
				],
			});
		default:
			return ordering({
				...common,
				content: "text",
				lines: q.key.map(
					(k) => [0, k.text.replace(/^\d+\. /, "")] as [number, string],
				),
			});
	}
}
