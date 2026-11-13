import { type CodeQuestion, checkReport } from "mdq";
import { type ItemView, studentReportView } from "@/services/code-grading";

/// One case of a worker's report, with whether the student never sees it.
export interface InstructorCase {
	id?: string;
	verdict: string;
	message?: string;
	expected?: string;
	actual?: string;
	hidden: boolean;
}

/// A worker's report as the instructor reads it: every case, and the rubric items once it was graded.
export type InstructorReport =
	| {
			kind: "report";
			status: "completed" | "build-error" | "runner-error";
			cases: InstructorCase[];
			/// The compiler message of a build error.
			build?: string;
			/// The message of a runner error.
			message?: string;
			/// The items the report earned; absent while the report fails a pretest or has no grade.
			items?: ItemView[];
	  }
	| { kind: "invalid"; message: string };

/**
 * A raw runner report as the instructor reads it, each case marked hidden or public.
 *
 * A case is public when it falls in a public region of the question's tests.
 * A report that does not fit the question comes back as `invalid` with mdq's message.
 *
 * @example
 * instructorReport(question, report).kind; // "report"
 */
export function instructorReport(
	question: CodeQuestion,
	report: unknown,
): InstructorReport {
	try {
		const parsed = checkReport(question, report);
		if (parsed === null) {
			return { kind: "invalid", message: "the question has no test source" };
		}
		const view = studentReportView(question, report, {
			mode: "PRACTICE",
			attempts: 1,
			released: true,
		});
		const visible = new Set(
			view.publicCases.map((item) => `${item.source}:${item.line}`),
		);
		return {
			kind: "report",
			status: parsed.status,
			cases: parsed.cases.map((item) => ({
				verdict: item.verdict,
				...(item.id === undefined ? {} : { id: item.id }),
				...(item.message === undefined ? {} : { message: item.message }),
				...(item.expected === undefined ? {} : { expected: item.expected }),
				...(item.actual === undefined ? {} : { actual: item.actual }),
				hidden: !visible.has(`${item.source}:${item.line}`),
			})),
			...(parsed.build === undefined ? {} : { build: parsed.build }),
			...(parsed.message === undefined ? {} : { message: parsed.message }),
			...(view.items === undefined ? {} : { items: view.items }),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { kind: "invalid", message };
	}
}
