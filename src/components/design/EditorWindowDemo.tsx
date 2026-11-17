import type { JSX } from "solid-js";
import EditorWindow from "@/components/runner/EditorWindow";

/// One `EditorWindow` with a code area, starting in `initialState`, for the design catalogue.
export default function EditorWindowDemo(props: {
	initialState: "inline" | "collapsed";
}): JSX.Element {
	return (
		<EditorWindow
			filename="main.py"
			language="python"
			initialState={props.initialState}
			below={
				<pre class="min-h-16 p-3 font-mono text-sm text-base-content/70">
					Hello, world!
				</pre>
			}
		>
			<textarea
				class="textarea h-40 w-full rounded-none border-0 font-mono text-sm"
				spellcheck={false}
				aria-label="Code"
				value={'print("Hello, world!")\n'}
			/>
		</EditorWindow>
	);
}
