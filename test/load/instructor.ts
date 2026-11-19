/**
 * A synthetic instructor: signs in and keeps opening the pages an instructor
 * watches during an exam, which read the whole course and not one attempt.
 */

import { type Recorder, StudentHttp } from "./http";
import { CODE_QUESTIONS, ESSAY_QUESTIONS } from "./questions";
import { LOAD } from "./setup";

export interface InstructorContext {
	base: string;
	recorder: Recorder;
	/// Milliseconds between two rounds of pages.
	interval: number;
	/// Whether the database holds the old exam of `--history`.
	history: boolean;
	/// Whether the exam is over.
	done: () => boolean;
}

const COURSE = `/${LOAD.discipline}/${LOAD.courseSegment}`;

/// The staff screens of one exam, as `[name in the report, path]`.
function examPages(
	label: string,
	exam: string,
	question: string | undefined,
): [string, string][] {
	const base = `${COURSE}/exams/${exam}`;
	return [
		[`instructor:${label}`, base],
		[`instructor:${label}:grading`, `${base}/grading`],
		[`instructor:${label}:question`, `${base}/grading/${question}`],
		[`instructor:${label}:exceptions`, `${base}/exceptions`],
		[`instructor:${label}:results`, `${base}/results`],
	];
}

/// The pages of one round: the course, the exam under way and, with `history`, the old exam that holds the autosaves.
function pagesOf(history: boolean): [string, string][] {
	return [
		["instructor:home", "/home"],
		["instructor:course", COURSE],
		...examPages("exam", LOAD.exam, ESSAY_QUESTIONS[0]?.slug),
		...(history
			? examPages("history", `${LOAD.exam}-history`, CODE_QUESTIONS[0]?.slug)
			: []),
	];
}

/// Opens the instructor's pages every `interval` until the exam is over. Never throws.
export async function runInstructor(ctx: InstructorContext): Promise<void> {
	const http = new StudentHttp(ctx.base, ctx.recorder, LOAD.instructor);
	const pages = pagesOf(ctx.history);
	let signedIn = false;
	while (!ctx.done()) {
		await sleep(ctx.interval, ctx.done);
		if (ctx.done()) return;
		// The login fails while the server is down; it is tried again on the next round.
		signedIn ||= await http.login(LOAD.instructor, LOAD.password);
		if (!signedIn) continue;
		for (const [name, path] of pages) await http.page(name, path);
	}
}

/// Waits `ms`, or less when `done` turns true.
async function sleep(ms: number, done: () => boolean): Promise<void> {
	const until = Date.now() + ms;
	while (Date.now() < until && !done())
		await new Promise((resolve) =>
			setTimeout(resolve, Math.min(500, until - Date.now())),
		);
}
