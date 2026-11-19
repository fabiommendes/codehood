/**
 * The timings and actions of the exam page, read from its own source so the
 * synthetic student follows the real client without a copy to keep in sync.
 *
 * The page keeps its timings as module constants. Reading them here, instead
 * of importing, leaves the client untouched; a constant that is renamed or
 * stops being a plain number throws, and `test/load-rhythm.spec.ts` fails.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

export const CLIENT_SOURCES = {
	attempt: "src/components/exam/ExamAttempt.tsx",
	session: "src/components/exam/answer-edit-session.ts",
} as const;

function source(file: string): string {
	return readFileSync(path.join(ROOT, file), "utf8");
}

/// The value of `const NAME = 1_500;` in `file`.
function constant(file: string, name: string): number {
	const match = source(file).match(
		new RegExp(`const ${name}\\s*=\\s*([0-9_]+)\\s*;`),
	);
	if (match?.[1] === undefined)
		throw new Error(`${name} is no longer a numeric constant of ${file}`);
	return Number(match[1].replaceAll("_", ""));
}

/// The exam page's timings, in milliseconds.
export function clientRhythm() {
	return {
		/// The longest a typed answer waits to be saved while the student keeps typing.
		saveIntervalMs: constant(CLIENT_SOURCES.attempt, "SAVE_INTERVAL_MS"),
		/// A save unanswered for this long counts as a failed connection.
		saveTimeoutMs: constant(CLIENT_SOURCES.attempt, "SAVE_TIMEOUT_MS"),
		/// Interval of `gradingJob.forStudentQuestions` while a send waits for its worker.
		sendsPollMs: constant(CLIENT_SOURCES.attempt, "SENDS_POLL_MS"),
		/// Longest the page waits for the history's last flush.
		historyFinalWaitMs: constant(
			CLIENT_SOURCES.attempt,
			"HISTORY_FINAL_WAIT_MS",
		),
		/// Longest the history's final flush holds the submit button.
		flushCeilingMs: constant(CLIENT_SOURCES.session, "FLUSH_CEILING_MS"),
	};
}

export type ClientRhythm = ReturnType<typeof clientRhythm>;

/// The actions the exam page calls for a student, as `group.name`, from `actions.group.name(` in its source.
export function clientActions(): string[] {
	const found = new Set<string>();
	for (const match of source(CLIENT_SOURCES.attempt).matchAll(
		/\bactions\.(\w+)\.(\w+)\s*\(/g,
	)) {
		found.add(`${match[1]}.${match[2]}`);
	}
	// The page hands `actions.answerHistory` to the session, which calls it by endpoint.
	if (
		/actions:\s*actions\.answerHistory\b/.test(source(CLIENT_SOURCES.attempt))
	) {
		for (const endpoint of source(CLIENT_SOURCES.session).matchAll(
			/"(inspect|send)"/g,
		)) {
			found.add(`answerHistory.${endpoint[1]}`);
		}
	}
	for (const action of INSTRUCTOR_ACTIONS) found.delete(action);
	return [...found].sort();
}

/// The actions the exam page calls only for an instructor simulating the exam, which no student reaches.
const INSTRUCTOR_ACTIONS = ["exam.restartPreview"];

/// The actions the synthetic student calls; `test/load-rhythm.spec.ts` checks it matches the page.
export const STUDENT_ACTIONS = [
	"answerHistory.inspect",
	"answerHistory.send",
	"exam.answer",
	"exam.finish",
	"exam.start",
	"gradingJob.forStudentQuestions",
].sort();
