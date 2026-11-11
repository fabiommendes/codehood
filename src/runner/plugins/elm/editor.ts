import { StreamLanguage } from "@codemirror/language";
import { elm } from "@codemirror/legacy-modes/mode/elm";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for Elm. */
export default (): Extension => StreamLanguage.define(elm);
