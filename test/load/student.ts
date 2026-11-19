/**
 * A synthetic student: draws a profile, then takes the exam question by
 * question with `solveQuestion`, which knows nothing of the question's kind
 * beyond its candidate answers.
 */

import type { InputKind } from "@/services/answer-edits/codec";
import { type Recorder, StudentHttp } from "./http";
import { ExamPage, type ExamTarget, type GradingWait } from "./page";
import type { ClientRhythm } from "./rhythm";

/// One candidate answer; `answers[0]` of a question is the right one.
export interface Answer {
	text: string;
	/// What it should get: `correct`, `failsPretest`, `partial`, ...
	outcome: string;
}

/// What the student needs to know of a question, whatever its type.
export interface LoadQuestion {
	slug: string;
	type: string;
	stem: string;
	answers: Answer[];
	/// Whether the answer goes to a grading worker (a submit button).
	sendable: boolean;
}

type Range = readonly [number, number];

/// How a kind of student behaves. Times are in milliseconds.
export interface Profile {
	name: string;
	/// Share of the class.
	weight: number;
	/// Reading time per character of the stem.
	readPerChar: Range;
	/// Share of the student's think budget spent on one question, before typing.
	think: Range;
	/// Mean time between two keys.
	keyMs: Range;
	/// Chance, per key, of stopping to think.
	pauseChance: number;
	pause: Range;
	/// Keys typed in one go, before a short stop.
	burst: Range;
	/// The short stop between two bursts, in key times; the page saves when it outlasts the autosave delay.
	breath: Range;
	/// Chance of pasting the answer instead of typing it.
	paste: number;
	/// Small edits made after a paste.
	editsAfterPaste: Range;
	/// Slips per answer: text typed and deleted later, besides the answer's own `<remove>` spans.
	slips: Range;
	/// Chance of leaving a question blank.
	skip: number;
	/// Wrong answers tried before the last one.
	wrongTries: Range;
	/// Chance that the last answer is the right one.
	getsItRight: number;
	/// Chance of sending each try of a sendable question.
	submit: number;
	/// Spread of the question order: 0 follows the exam, 1 swaps neighbours often.
	orderNoise: number;
	/// Chance of giving up on the rest of the exam after each question.
	quit: number;
	/// Chance of handing the attempt in at the end (the rest just close the tab).
	finishes: number;
	/// Share of an essay the student writes.
	essayShare: Range;
}

export const PROFILES: Profile[] = [
	{
		name: "careful",
		burst: [1, 6],
		breath: [1.5, 5],
		slips: [1, 4],
		weight: 40,
		readPerChar: [60, 120],
		think: [0.6, 1.2],
		keyMs: [150, 300],
		pauseChance: 0.02,
		pause: [2_000, 12_000],
		paste: 0.02,
		editsAfterPaste: [0, 2],
		skip: 0.05,
		wrongTries: [0, 2],
		getsItRight: 0.85,
		submit: 0.85,
		orderNoise: 0.3,
		quit: 0.01,
		finishes: 0.97,
		essayShare: [0.8, 1],
	},
	{
		name: "paster",
		burst: [1, 7],
		breath: [1.5, 4.5],
		slips: [0, 1],
		weight: 20,
		readPerChar: [20, 60],
		think: [0.3, 0.8],
		keyMs: [150, 260],
		pauseChance: 0.01,
		pause: [2_000, 8_000],
		paste: 0.85,
		editsAfterPaste: [1, 6],
		skip: 0.05,
		wrongTries: [0, 1],
		getsItRight: 0.9,
		submit: 0.9,
		orderNoise: 0.5,
		quit: 0.01,
		finishes: 0.95,
		essayShare: [0.9, 1],
	},
	{
		name: "fast",
		burst: [2, 10],
		breath: [3, 8],
		slips: [0, 3],
		weight: 15,
		readPerChar: [30, 60],
		think: [0.2, 0.6],
		keyMs: [80, 150],
		pauseChance: 0.01,
		pause: [1_000, 5_000],
		paste: 0.1,
		editsAfterPaste: [0, 2],
		skip: 0.02,
		wrongTries: [0, 1],
		getsItRight: 0.9,
		submit: 0.6,
		orderNoise: 0.3,
		quit: 0.005,
		finishes: 0.98,
		essayShare: [0.6, 1],
	},
	{
		name: "stuck",
		burst: [1, 5],
		breath: [1.2, 4],
		slips: [2, 6],
		weight: 15,
		readPerChar: [100, 250],
		think: [0.8, 1.6],
		keyMs: [200, 450],
		pauseChance: 0.04,
		pause: [5_000, 30_000],
		paste: 0.05,
		editsAfterPaste: [0, 3],
		skip: 0.3,
		wrongTries: [1, 3],
		getsItRight: 0.5,
		submit: 0.6,
		orderNoise: 1.0,
		quit: 0.03,
		finishes: 0.9,
		essayShare: [0.3, 0.9],
	},
	{
		name: "quitter",
		burst: [1, 6],
		breath: [1.5, 5],
		slips: [1, 4],
		weight: 10,
		readPerChar: [60, 150],
		think: [0.4, 1.0],
		keyMs: [200, 350],
		pauseChance: 0.03,
		pause: [3_000, 20_000],
		paste: 0.05,
		editsAfterPaste: [0, 2],
		skip: 0.5,
		wrongTries: [0, 2],
		getsItRight: 0.4,
		submit: 0.5,
		orderNoise: 0.8,
		quit: 0.3,
		finishes: 0.5,
		essayShare: [0.1, 0.6],
	},
];

/// Mulberry32: a small seeded generator, so a run can be repeated.
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export class Dice {
	constructor(readonly random: () => number) {}
	chance(p: number): boolean {
		return this.random() < p;
	}
	between([low, high]: Range): number {
		return low + (high - low) * this.random();
	}
	int([low, high]: Range): number {
		return Math.floor(low + (high - low + 1) * this.random());
	}
	pick<T>(items: readonly T[]): T {
		const item = items[Math.floor(this.random() * items.length)];
		if (item === undefined) throw new Error("Nothing to pick from");
		return item;
	}
	weighted<T extends { weight: number }>(items: readonly T[]): T {
		const total = items.reduce((sum, item) => sum + item.weight, 0);
		let roll = this.random() * total;
		for (const item of items) {
			roll -= item.weight;
			if (roll < 0) return item;
		}
		return this.pick(items.slice(-1));
	}
	gaussian(): number {
		const u = 1 - this.random();
		const v = this.random();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	}
}

/// The exam order with noise: each question's key is its index plus gaussian noise, so most students follow the exam and some jump ahead.
export function questionOrder<T>(
	questions: readonly T[],
	noise: number,
	dice: Dice,
): T[] {
	return questions
		.map((question, index) => ({
			question,
			key: index + noise * dice.gaussian(),
		}))
		.sort((a, b) => a.key - b.key)
		.map(({ question }) => question);
}

const REMOVE = /<remove>([\s\S]*?)<\/remove>/g;

/// `answer` as it is finally saved: without its `<remove>` spans.
export function cleanAnswer(answer: string): string {
	return answer.replace(REMOVE, "");
}

/// One piece of what the typist writes; a removable one is deleted later.
export interface Segment {
	text: string;
	removable: boolean;
	typed: number;
	gone: boolean;
}

/// The part of `answer` (spans included) after its first `cleanLength` clean characters.
function removalsAfter(answer: string, cleanLength: number): string {
	let clean = 0;
	let index = 0;
	while (index < answer.length && clean < cleanLength) {
		if (answer.startsWith("<remove>", index)) {
			const end = answer.indexOf("</remove>", index);
			index = end < 0 ? answer.length : end + "</remove>".length;
			continue;
		}
		clean++;
		index++;
	}
	return answer.slice(index);
}

/**
 * Splits `answer` into what is typed, keeping its `<remove>` spans and adding
 * `slips` more: a few characters typed ahead of time, or a word of the answer
 * repeated, at a space or a line break.
 */
export function typingPlan(
	answer: string,
	slips: number,
	dice: Dice,
): Segment[] {
	const segments: Segment[] = [];
	let last = 0;
	for (const match of answer.matchAll(REMOVE)) {
		if (match.index > last)
			segments.push(piece(answer.slice(last, match.index), false));
		segments.push(piece(match[1] ?? "", true));
		last = match.index + match[0].length;
	}
	if (last < answer.length) segments.push(piece(answer.slice(last), false));

	const words = cleanAnswer(answer).match(/[\p{L}\p{N}_.]{2,}/gu) ?? [];
	for (let slip = 0; slip < slips; slip++) {
		const kept = segments.filter((s) => !s.removable && /\s/.test(s.text));
		if (kept.length === 0) break;
		const segment = dice.pick(kept);
		const gaps = [...segment.text.matchAll(/\s/g)].map((m) => m.index + 1);
		const at = dice.pick(gaps);
		const ahead = segment.text.slice(at, at + dice.int([3, 12])).trim();
		const junk =
			dice.chance(0.5) && ahead
				? ahead
				: `${words.length ? dice.pick(words) : "x"} `;
		const index = segments.indexOf(segment);
		segments.splice(
			index,
			1,
			piece(segment.text.slice(0, at), false),
			piece(junk, true),
			piece(segment.text.slice(at), false),
		);
	}
	return segments.filter((s) => s.text.length > 0);
}

function piece(text: string, removable: boolean): Segment {
	return { text, removable, typed: 0, gone: false };
}

/// What a scenario lets the students do.
export interface Behaviour {
	/// Type answers key by key; without it every answer arrives whole.
	typing: boolean;
	/// Send answers to the worker.
	sends: boolean;
	/// Record the edit history (when the exam's switch is on).
	history: boolean;
	/// Answer only sendable questions, without reading or thinking: the queue scenario.
	burst: boolean;
}

export interface StudentRun {
	username: string;
	profile: string;
	/// Questions answered, skipped, sends made.
	answered: number;
	skipped: number;
	sends: number;
	finished: boolean;
	/// Why it stopped early, if it did.
	failure?: string;
}

export interface StudentContext {
	base: string;
	target: ExamTarget;
	username: string;
	password: string;
	questions: LoadQuestion[];
	rhythm: ClientRhythm;
	recorder: Recorder;
	gradingWaits: GradingWait[];
	behaviour: Behaviour;
	dice: Dice;
	/// When the student arrives, and when the exam ends, in ms since the run started.
	arriveAt: number;
	deadline: number;
	/// The think budget of the whole exam, spread over its questions.
	thinkBudgetMs: number;
	startedAt: number;
}

/// Raised inside a student when the exam time is over.
class TimeUp extends Error {}

/// Typing, pasting and waiting on one page, bounded by the exam's deadline.
class Hands {
	text = "";
	constructor(
		private readonly ctx: StudentContext,
		private readonly page: ExamPage,
		private readonly profile: Profile,
		private readonly question: LoadQuestion,
	) {
		this.keyMs = ctx.dice.between(profile.keyMs);
	}
	private readonly keyMs: number;

	private now(): number {
		return Date.now() - this.ctx.startedAt;
	}

	async wait(ms: number): Promise<void> {
		const left = this.ctx.deadline - this.now();
		if (left <= 0) throw new TimeUp();
		await sleep(Math.min(ms, left));
		if (this.now() >= this.ctx.deadline) throw new TimeUp();
	}

	private emit(kind: InputKind): void {
		this.page.change(this.question.slug, this.question.type, this.text, kind);
	}

	/// Replaces the answer at once, as a paste of the whole text.
	async paste(text: string): Promise<void> {
		await this.wait(this.ctx.dice.between([300, 1500]));
		this.text = cleanAnswer(text);
		this.emit("paste");
	}

	/**
	 * Edits the answer key by key until it reads `target` without its `<remove>` spans.
	 *
	 * Deletes back to the prefix it shares with the current text, then types
	 * the rest in bursts, spans included. After each burst it may go back and
	 * delete the last span still there, which by then sits in the middle of the
	 * text; the spans left at the end are deleted, last first.
	 */
	async typeTo(target: string): Promise<void> {
		const { dice } = this.ctx;
		const clean = cleanAnswer(target);
		if (!this.ctx.behaviour.typing) {
			this.text = clean;
			this.emit("paste");
			return;
		}
		let prefix = 0;
		while (
			prefix < this.text.length &&
			prefix < clean.length &&
			this.text[prefix] === clean[prefix]
		)
			prefix++;
		while (this.text.length > prefix) {
			await this.wait(this.keyMs * dice.between([0.3, 0.8]));
			this.text = this.text.slice(0, -1);
			this.emit("delete");
		}
		const head = this.text;
		const segments = typingPlan(
			removalsAfter(target, prefix),
			dice.int(this.profile.slips),
			dice,
		);
		const render = () =>
			head + segments.map((s) => s.text.slice(0, s.typed)).join("");
		const removeSpan = async (span: Segment) => {
			while (span.typed > 0) {
				await this.wait(this.keyMs * dice.between([0.3, 0.8]));
				span.typed--;
				this.text = render();
				this.emit("delete");
			}
			span.gone = true;
		};
		const lastSpan = () =>
			segments.findLast((s) => s.removable && !s.gone && s.typed > 0);

		let burst = dice.int(this.profile.burst);
		for (const segment of segments) {
			while (segment.typed < segment.text.length) {
				await this.wait(this.keyMs * dice.between([0.4, 1.6]));
				segment.typed++;
				this.text = render();
				this.emit("typing");
				if (--burst > 0) continue;
				burst = dice.int(this.profile.burst);
				if (dice.chance(this.profile.pauseChance * 3))
					await this.wait(dice.between(this.profile.pause));
				else await this.wait(this.keyMs * dice.between(this.profile.breath));
				const span = lastSpan();
				// Not the span being typed: that one is finished first.
				if (span && span !== segment && dice.chance(0.35))
					await removeSpan(span);
			}
		}
		for (let span = lastSpan(); span; span = lastSpan()) {
			await this.wait(this.keyMs * dice.between([2, 6]));
			await removeSpan(span);
		}
	}

	/// A few small edits: a word typed in the middle and taken back.
	async tweak(times: number): Promise<void> {
		for (let edit = 0; edit < times; edit++) {
			if (this.text.length === 0) return;
			const at = Math.floor(this.ctx.dice.random() * this.text.length);
			const original = this.text;
			const word = " x";
			for (let i = 1; i <= word.length; i++) {
				await this.wait(this.keyMs);
				this.text =
					original.slice(0, at) + word.slice(0, i) + original.slice(at);
				this.emit("typing");
			}
			await this.wait(this.ctx.dice.between([1_000, 6_000]));
			for (let i = word.length - 1; i >= 0; i--) {
				await this.wait(this.keyMs * 0.5);
				this.text =
					original.slice(0, at) + word.slice(0, i) + original.slice(at);
				this.emit("delete");
			}
		}
	}
}

/**
 * Answers one question the way `profile` would: reads, thinks, types or
 * pastes, tries wrong answers before the last one, and sends each try with
 * the profile's chance when the question goes to a worker.
 *
 * Returns whether the question was answered at all.
 */
export async function solveQuestion(
	ctx: StudentContext,
	page: ExamPage,
	question: LoadQuestion,
	profile: Profile,
	run: StudentRun,
): Promise<boolean> {
	const { dice, behaviour } = ctx;
	const hands = new Hands(ctx, page, profile, question);

	if (behaviour.burst) {
		if (!question.sendable) return false;
		await hands.typeTo(question.answers[0]?.text ?? "");
		if (await page.submit(question.slug, hands.text)) run.sends++;
		return true;
	}

	await hands.wait(question.stem.length * dice.between(profile.readPerChar));
	if (dice.chance(profile.skip)) return false;
	await hands.wait(
		(dice.between(profile.think) * ctx.thinkBudgetMs) / ctx.questions.length,
	);

	const right = question.answers[0];
	if (!right) return false;
	const wrong = question.answers.slice(1);
	const tries: Answer[] = [];
	if (wrong.length > 0) {
		for (let i = dice.int(profile.wrongTries); i > 0; i--)
			tries.push(dice.pick(wrong));
	}
	tries.push(
		dice.chance(profile.getsItRight) || wrong.length === 0
			? right
			: dice.pick(wrong),
	);

	for (const [index, attempt] of tries.entries()) {
		let target = attempt.text;
		if (!question.sendable && question.type === "essay") {
			// An essay is written to some length, never "tried".
			const clean = cleanAnswer(target);
			target = clean.slice(
				0,
				Math.ceil(clean.length * dice.between(profile.essayShare)),
			);
		}
		if (index === 0 && dice.chance(profile.paste)) {
			await hands.paste(target);
			await hands.tweak(dice.int(profile.editsAfterPaste));
		} else {
			await hands.typeTo(target);
		}
		if (question.sendable && behaviour.sends && dice.chance(profile.submit)) {
			const left = page.sendsLeft(question.slug);
			if (left !== null && left <= 0) break;
			await hands.wait(dice.between([2_000, 20_000]));
			if (await page.submit(question.slug, hands.text)) {
				run.sends++;
				// The student watches the result for a while before moving on.
				const patience = dice.between([20_000, 90_000]);
				const since = Date.now();
				while (page.waiting(question.slug) && Date.now() - since < patience) {
					await hands.wait(1_000);
				}
			}
		}
		if (index < tries.length - 1)
			await hands.wait(dice.between([5_000, 40_000]));
	}
	return true;
}

/// Takes the exam from login to hand-in. Never throws.
export async function runStudent(ctx: StudentContext): Promise<StudentRun> {
	const { dice } = ctx;
	const profile = ctx.behaviour.burst
		? dice.pick(PROFILES.slice(0, 1))
		: dice.weighted(PROFILES);
	const run: StudentRun = {
		username: ctx.username,
		profile: ctx.behaviour.burst ? "burst" : profile.name,
		answered: 0,
		skipped: 0,
		sends: 0,
		finished: false,
	};
	const http = new StudentHttp(ctx.base, ctx.recorder, ctx.username);
	const pageUrl = `/${ctx.target.discipline}/${ctx.target.course}/exams/${ctx.target.exam}`;
	let page: ExamPage | null = null;
	try {
		await sleep(Math.max(0, ctx.arriveAt - (Date.now() - ctx.startedAt)));
		if (!(await http.login(ctx.username, ctx.password)))
			throw new Error("login refused");
		await http.page("page:exam", pageUrl);
		const started = await http.action("exam.start", ctx.target);
		if (started.error && started.error.code !== "CONFLICT")
			throw new Error(`exam.start: ${started.error.code}`);
		const props = await http.page("page:exam", pageUrl, "ExamAttempt");
		const attempt = props?.attempt;
		if (typeof attempt !== "string")
			throw new Error("the exam page has no attempt");
		page = new ExamPage(
			http,
			ctx.rhythm,
			ctx.target,
			attempt,
			ctx.startedAt,
			ctx.gradingWaits,
			ctx.startedAt + ctx.deadline,
		);
		if (ctx.behaviour.history && props?.answerHistory === true)
			page.startHistory(ctx.username, ctx.questions);

		const order = ctx.behaviour.burst
			? ctx.questions
			: questionOrder(ctx.questions, profile.orderNoise, dice);
		for (const question of order) {
			if (await solveQuestion(ctx, page, question, profile, run))
				run.answered++;
			else run.skipped++;
			page.leave(question.slug);
			if (!ctx.behaviour.burst && dice.chance(profile.quit)) break;
		}
		// Done early: look the answers over, or wait for the sends, for a while.
		if (!ctx.behaviour.burst)
			await sleep(
				Math.min(
					dice.between([5_000, 60_000]),
					Math.max(0, ctx.deadline - (Date.now() - ctx.startedAt)),
				),
			);
		else
			while (
				ctx.questions.some((q) => page?.waiting(q.slug)) &&
				Date.now() - ctx.startedAt < ctx.deadline
			)
				await sleep(1_000);
	} catch (error) {
		if (!(error instanceof TimeUp)) {
			run.failure = error instanceof Error ? error.message : String(error);
		}
	}
	if (page) {
		// A student still on the page when the time runs out hands nothing in: the page sends what is pending and shows the attempt as submitted.
		const timeUp = Date.now() - ctx.startedAt >= ctx.deadline;
		if (ctx.behaviour.burst || (!timeUp && dice.chance(profile.finishes))) {
			await page.finish(pageUrl);
			run.finished = true;
		} else {
			await page.flush();
			page.close();
		}
	}
	return run;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
