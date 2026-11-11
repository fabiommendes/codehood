import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for Lua. */
export default (): Extension => StreamLanguage.define(lua);
