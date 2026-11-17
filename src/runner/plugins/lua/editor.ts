import { completeAnyWord } from "@codemirror/autocomplete";
import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for Lua, completing the words already in the source. */
export default (): Extension => {
	const language = StreamLanguage.define(lua);
	return [language, language.data.of({ autocomplete: completeAnyWord })];
};
