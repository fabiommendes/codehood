import type { ReportCase, RunnerReport } from "../runner/run-tests";

/** What the status line of a pretest run says. */
export type PretestSummary =
	| { kind: "passed"; total: number }
	| { kind: "failed"; failed: number; total: number }
	| { kind: "build-error"; build: string }
	| { kind: "runner-error"; message: string };

/**
 * Reduces a runner report to the line shown above the cases.
 *
 * Only `pass` passes: `skipped`, `timeout` and the others count as failed. A
 * completed report with no case is a runner error, since nothing was tested.
 */
export function summarizeReport(report: RunnerReport): PretestSummary {
	if (report.status === "build-error") {
		return { kind: "build-error", build: report.build ?? "" };
	}
	if (report.status === "runner-error" || report.cases.length === 0) {
		return { kind: "runner-error", message: report.message ?? "" };
	}
	const total = report.cases.length;
	const failed = report.cases.filter(
		(item: ReportCase) => item.verdict !== "pass",
	).length;
	return failed === 0
		? { kind: "passed", total }
		: { kind: "failed", failed, total };
}
