import { javascript } from "@codemirror/lang-javascript";
import type { Extension } from "@codemirror/state";

/** CodeMirror support for TypeScript. */
export default (): Extension => javascript({ typescript: true });
