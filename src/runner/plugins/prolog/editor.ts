import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { prolog } from "./mode";

/** CodeMirror support for Prolog. */
export default (): Extension => StreamLanguage.define(prolog);
