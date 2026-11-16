import type { JSX } from "solid-js";
import { CodeAnswer, type CodeAnswerProps } from "@/components/exam/CodeAnswer";
import type { CodeSends } from "@/components/exam/code-sends";
import type { RunnerReport } from "@/components/runner/run-tests";

interface Props extends Pick<CodeAnswerProps, "question" | "pretests"> {
	/// Shows the counter and the list of sends under the editor; the answer still has no submit button.
	withSends?: boolean;
}

/// The sends of an answer: one the worker is still grading and one it has graded.
const SENDS: CodeSends = {
	used: 2,
	limit: 5,
	submissions: [
		{ submission: "send-1", jobState: "DONE" },
		{ submission: "send-2", jobState: "QUEUED" },
	],
};

/// A pretest report with one pass and one fail, as the runner would send it.
const REPORT: RunnerReport = {
	status: "completed",
	cases: [
		{ source: 0, line: 4, verdict: "pass", id: "test_small" },
		{
			source: 0,
			line: 8,
			verdict: "fail",
			id: "test_large",
			message: "assert add(10**9, 10**9) == 2 * 10**9",
			expected: "2000000000",
			actual: "None",
		},
	],
};

/** A code answer whose pretests return a made-up report, and that sends nothing, for the design catalogue. */
export default function CodeAnswerDemo(props: Props): JSX.Element {
	return (
		<CodeAnswer
			question={props.question}
			pretests={props.pretests}
			value={null}
			onChange={() => {}}
			runnerOrigin="https://runner.example"
			sends={props.withSends ? SENDS : undefined}
			runTests={async () => REPORT}
		/>
	);
}
