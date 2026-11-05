import type { JSONObject } from "@/typing/concrete-types";

/// A stored version: the public half and its complement.
export type LegacyVersion = {
	publicPayload: JSONObject;
	privatePayload: JSONObject;
};

/// Versions as Codehood 0.2 stored them: a public half and its complement.
export const LEGACY: Record<
	"multipleChoice" | "essay" | "fillIn",
	LegacyVersion
> = {
	multipleChoice: {
		publicPayload: {
			type: "multiple-choice",
			title: "Soma",
			stem: "Quanto é 2 + 2?",
			preamble: "Considere a aritmética usual.",
			tags: [],
			choices: [
				{ id: "three", text: "3" },
				{ id: "four", text: "4" },
			],
		},
		privatePayload: { choices: [{}, { score: 1, feedback: "Isso." }] },
	},
	essay: {
		publicPayload: {
			type: "essay",
			id: "publicando",
			title: "Publicando",
			stem: "Descreva o build.",
			tags: ["build"],
			input: "text",
		},
		privatePayload: { locale: "pt-BR", answerKey: "Compila e minifica." },
	},
	fillIn: {
		publicPayload: {
			type: "fill-in",
			id: "cabeca-cauda",
			title: "Cabeça e cauda",
			stem: "A cabeça é [^cabeca] e a cauda tem [^n] elementos.",
			tags: [],
			blanks: [
				{ id: "cabeca", type: "short-answer" },
				{ id: "n", type: "numeric", domain: "integer" },
			],
		},
		privatePayload: {
			locale: "pt-BR",
			blanks: [{ oneOf: ["tucano"] }, { answer: 2 }],
		},
	},
};
