import type { PublicCodeQuestion } from "mdq";
import { type Accessor, createSignal, type JSX, onMount } from "solid-js";
import { CodeAnswer } from "@/components/exam/CodeAnswer";
import type { CodeSends } from "@/components/exam/code-sends";
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

/// What the fake submit does: send, refuse because the sends ran out, or never finish.
export type SubmitScenario = "ok" | "exhausted" | "sending";

/// A fake `onSubmit` that answers as `scenario` says and, when it sends, adds a queued send to `sends`.
function fakeSubmit(
	scenario: SubmitScenario,
	sends: Accessor<CodeSends>,
	setSends: (sends: CodeSends) => void,
) {
	return (_code: string): Promise<void> =>
		new Promise((resolve, reject) => {
			if (scenario === "sending") return;
			setTimeout(() => {
				if (scenario === "exhausted") {
					reject(new Error("You have no sends left for this question"));
					return;
				}
				const current = sends();
				setSends({
					...current,
					submissions: [
						...current.submissions,
						{
							submission: `s${current.submissions.length}`,
							jobState: "QUEUED",
						},
					],
				});
				resolve();
			}, 600);
		});
}

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
	exampleHtml: readonly string[];
	/// Shows the submit button with a fake queue, and presses it on mount when `press` is set; none leaves the button out.
	submit?: { scenario: SubmitScenario; sends: CodeSends; press: boolean };
}): JSX.Element {
	const [sends, setSends] = createSignal<CodeSends>(
		props.submit?.sends ?? { used: 0, limit: null, submissions: [] },
	);
	let root!: HTMLDivElement;
	onMount(() => {
		if (props.submit?.press) {
			root.querySelector<HTMLButtonElement>("[data-action=submit]")?.click();
		}
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
				exampleHtml={props.exampleHtml}
				onSubmit={
					props.submit && fakeSubmit(props.submit.scenario, sends, setSends)
				}
				sends={props.submit ? sends() : undefined}
				value={null}
				onChange={() => {}}
				runTests={fake(props.scenario)}
			/>
		</div>
	);
}
