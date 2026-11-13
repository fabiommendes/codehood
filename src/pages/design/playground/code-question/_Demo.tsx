import type { PublicCodeQuestion } from "mdq";
import { type JSX, onMount } from "solid-js";
import { CodeAnswer } from "@/components/exam/CodeAnswer";
import type {
	ReportCase,
	RunnerReport,
	TestRun,
} from "@/components/runner/run-tests";
import type { PretestSource } from "@/utils/pretest-sources";

export type Scenario =
	| "pass"
	| "fail"
	| "build-error"
	| "runner-error"
	| "running"
	| "unavailable";

const pass = (id: string, message: string): ReportCase => ({
	source: 0,
	verdict: "pass",
	id,
	message,
});

/// A fake `runTests` that answers after a short delay as `scenario` says.
function fake(scenario: Scenario) {
	return (_run: TestRun, signal?: AbortSignal): Promise<RunnerReport> =>
		new Promise((resolve, reject) => {
			signal?.addEventListener("abort", () => reject(new Error("aborted")));
			const done = (report: RunnerReport) =>
				setTimeout(() => resolve(report), 600);
			switch (scenario) {
				case "running":
					return;
				case "unavailable":
					return void setTimeout(
						() => reject(new Error("runTests: not implemented")),
						300,
					);
				case "pass":
					return done({
						status: "completed",
						cases: [
							pass("vazia", "Soma a lista vazia e um elemento"),
							pass("um", "Soma a lista vazia e um elemento"),
						],
					});
				case "fail":
					return done({
						status: "completed",
						cases: [
							pass("vazia", "Soma a lista vazia e um elemento"),
							{
								source: 0,
								verdict: "fail",
								id: "um",
								message: "Soma a lista vazia e um elemento",
								expected: "7",
								actual: "0",
							},
							{ source: 0, verdict: "timeout", id: "longa" },
						],
					});
				case "build-error":
					return done({
						status: "build-error",
						cases: [],
						build:
							'-- TYPE MISMATCH ---------------------- Main.elm\n\nThe 1st branch of this `if` does not match the 2nd:\n\n7|     if List.isEmpty xs then "zero" else 1\n                                 ^^^^\nThe `else` branch is a number but the `then` branch is a string.',
					});
				case "runner-error":
					return done({
						status: "runner-error",
						cases: [],
						message: "elm-test is not available in this browser",
					});
			}
		});
}

/** One `CodeAnswer` with a fake runner that starts a run on mount. */
export default function Demo(props: {
	question: PublicCodeQuestion;
	pretests: PretestSource[];
	scenario: Scenario;
	autorun: boolean;
}): JSX.Element {
	let root!: HTMLDivElement;
	onMount(() => {
		if (props.autorun) {
			root
				.querySelector<HTMLButtonElement>("[data-action=run-pretests]")
				?.click();
		}
	});
	return (
		<div ref={root}>
			<CodeAnswer
				question={props.question}
				pretests={props.pretests}
				value={null}
				onChange={() => {}}
				runTests={fake(props.scenario)}
			/>
		</div>
	);
}
