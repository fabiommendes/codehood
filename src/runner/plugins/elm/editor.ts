import { completeAnyWord } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { elm } from "@codemirror/legacy-modes/mode/elm";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for Elm, completing the words already in the source. */
export default (): Extension => {
	const language = StreamLanguage.define(elm);
	return [language, language.data.of({ autocomplete: completeAnyWord })];
};
