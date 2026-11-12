import { StreamLanguage } from "@codemirror/language";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for Scheme. */
export default (): Extension => StreamLanguage.define(scheme);
