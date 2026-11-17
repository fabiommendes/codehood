import { python } from "@codemirror/lang-python";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for Python. */
export default (): Extension => python();
