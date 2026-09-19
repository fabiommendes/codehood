/** Field masks over the MDQ schemas, for picking and omitting. */
import type { QuestionBase } from "./schemas-generated";

/** Everything MDQ puts on a question, whatever its type. */
export const questionBaseFields = {
	id: true,
	uuid: true,
	title: true,
	author: true,
	stem: true,
	preamble: true,
	epilogue: true,
	comment: true,
	locale: true,
	tags: true,
	meta: true,
} as const satisfies Record<keyof QuestionBase, true>;

/** The fields every public representation carries. */
export const commonPublicFields = {
	type: true,
	id: true,
	title: true,
	stem: true,
	preamble: true,
	epilogue: true,
	tags: true,
} as const;

/** The same, minus the discriminator. */
export const commonPublicFieldsExceptType = {
	id: true,
	title: true,
	stem: true,
	preamble: true,
	epilogue: true,
	tags: true,
} as const;
