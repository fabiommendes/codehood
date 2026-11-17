import { completeAnyWord } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { prolog } from "./mode";

/** CodeMirror support for Prolog, completing the words already in the source. */
export default (): Extension => {
	const language = StreamLanguage.define(prolog);
	return [language, language.data.of({ autocomplete: completeAnyWord })];
};
