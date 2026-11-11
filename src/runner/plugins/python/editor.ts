import { StreamLanguage } from "@codemirror/language";
import { python } from "@codemirror/legacy-modes/mode/python";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for Python. */
export default (): Extension => StreamLanguage.define(python);
