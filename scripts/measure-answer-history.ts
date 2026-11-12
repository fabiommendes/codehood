/**
 * Measures the answer-edit history of exams (spec
 * `dev/specs/to-review/historico-de-edicao-no-servidor.md`, T9): how big a history
 * gets, what a batch costs the server, how long the write transaction holds the
 * database, and what a summary costs. It is not part of any test suite.
 *
 * Each command works on a fresh database it creates under `--dir` (default
 * `/dev/shm/codehood-measure`, tmpfs; pass a directory on a real disk to count
 * the fsync of each commit). Never point it at `dev.db`.
 *
 * ```
 * tsx scripts/measure-answer-history.ts sizes   [--runs 30] [--dir D]
 * tsx scripts/measure-answer-history.ts cost    [--dir D]
 * tsx scripts/measure-answer-history.ts load    [herd|paced|storm] [--dir D]
 * tsx scripts/measure-answer-history.ts summary [--dir D]
 * ```
 *
 * Run it outside the Bash sandbox (the schema push needs it). Every number is
 * printed with its median and 95th percentile over the repetitions.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

const { values: args, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		dir: { type: "string", default: "/dev/shm/codehood-measure" },
		runs: { type: "string", default: "30" },
	},
});
const command = positionals[0] ?? "";
const RUNS = Number(args.runs);

// A fresh database, before any module reads `DATABASE_URL`.
mkdirSync(args.dir, { recursive: true });
const dbFile = path.join(args.dir, `${command}-${process.pid}.db`);
rmSync(dbFile, { force: true });
execSync(`node_modules/.bin/prisma db push --url "file:${dbFile}"`, {
	stdio: "ignore",
});
process.env.DATABASE_URL = `file:${dbFile}`;
process.env.ENVIRONMENT ??= "dev";

const { db } = await import("@/db");
const { prisma } = await import("@/db/client");
const support = await import("../test/answer-edit-service-support");
const { AnswerEditMonitor } = await import("@/services/answer-edits/monitor");
const { batchContentHash, replayBatch } = await import(
	"@/services/answer-edits/server-batch"
);
const { answerEditBatchInput, answerEditItemEnvelope } = await import(
	"@/core/schemas/answer-edit"
);
const constants = await import("@/core/constants");

type Batch = import("@/db/services/answer-edit.service").AnswerEditBatchInput;
type World = Awaited<ReturnType<typeof support.makeWorld>>;

//
// Statistics
//

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const rank = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] as number;
}

/// Median, 95th percentile, minimum and maximum of `values`.
function stats(values: number[]) {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		n: sorted.length,
		med: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		p99: percentile(sorted, 99),
		min: sorted[0] ?? Number.NaN,
		max: sorted.at(-1) ?? Number.NaN,
	};
}

function fmt(value: number, digits = 1): string {
	return value.toLocaleString("en-US", {
		maximumFractionDigits: digits,
		minimumFractionDigits: digits,
	});
}

function line(label: string, values: number[], unit: string, digits = 1) {
	const s = stats(values);
	console.log(
		`${label.padEnd(46)} med ${fmt(s.med, digits)}  p95 ${fmt(s.p95, digits)}  max ${fmt(s.max, digits)} ${unit}  (n=${s.n})`,
	);
}

//
// Random numbers
//

/// A small seeded generator, so a run can be repeated.
class Rng {
	constructor(private state: number) {}

	next(): number {
		this.state = (this.state + 0x6d2b79f5) | 0;
		let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	between(low: number, high: number): number {
		return low + (high - low) * this.next();
	}

	int(low: number, high: number): number {
		return Math.floor(this.between(low, high + 1));
	}

	chance(p: number): boolean {
		return this.next() < p;
	}

	pick<T>(items: readonly T[]): T {
		return items[this.int(0, items.length - 1)] as T;
	}

	gauss(): number {
		const u = 1 - this.next();
		return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
	}
}

//
// A simulated student
//

/// What the browser would have sent: the batches collected at one flush.
interface Flush {
	atMs: number;
	items: { slug: string; batch: Batch }[];
}

/// Session clock that runs the page's periodic flush (every 55 to 65 s).
class Session {
	now = 1000;
	readonly flushes: Flush[] = [];
	private nextFlush: number;
	readonly typists = new Map<string, Typist>();

	constructor(private readonly rng: Rng) {
		this.nextFlush = this.now + this.interval();
	}

	private interval(): number {
		return this.rng.between(55_000, 65_000);
	}

	advance(ms: number): void {
		this.now += Math.max(1, Math.round(ms));
		while (this.now >= this.nextFlush) {
			this.flush(this.nextFlush);
			this.nextFlush += this.interval();
		}
	}

	/// Collects every field with pending edits; the receipt is what the server will answer.
	flush(atMs = this.now): void {
		const items: Flush["items"] = [];
		for (const [slug, typist] of this.typists) {
			const { monitor } = typist;
			if (!monitor.getState().hasPendingChanges) continue;
			const batch = monitor.collect();
			if (!batch) continue;
			items.push({ slug, batch: support.fromMonitor(batch) });
			monitor.acknowledge({
				batchId: batch.batchId,
				revision: batch.baseRevision + 1,
				lastSeq: batch.firstSeq + batch.edits.length - 1,
			});
		}
		if (items.length > 0) this.flushes.push({ atMs, items });
	}

	/// The final flush, as `finish` does it.
	finish(): void {
		this.flush();
	}

	newTypist(slug: string, meanKeyMs: number): Typist {
		const typist = new Typist(this, this.rng, meanKeyMs, slug);
		this.typists.set(slug, typist);
		return typist;
	}
}

type Kind = "typing" | "delete" | "paste";

/// One text field typed through the real monitor, the way the editor drives it.
class Typist {
	readonly monitor: InstanceType<typeof AnswerEditMonitor>;
	cursor = 0;
	/// Characters the student typed or pasted, for the report.
	typed = 0;
	pasted = 0;

	constructor(
		private readonly session: Session,
		readonly rng: Rng,
		private readonly meanKeyMs: number,
		readonly slug: string,
	) {
		this.monitor = new AnswerEditMonitor({
			initialText: "",
			sessionId: `s-${slug}`,
			baseRevision: 0,
			firstSeq: 0,
			now: () => 0,
		});
	}

	get text(): string {
		return this.monitor.getState().text;
	}

	wait(ms: number): void {
		this.session.advance(ms);
	}

	private keyGap(): number {
		const factor = Math.exp(0.45 * this.rng.gauss() - 0.1);
		return Math.min(3000, Math.max(40, this.meanKeyMs * factor));
	}

	private change(
		kind: Kind,
		position: number,
		deleteCount: number,
		insertedText: string,
	): void {
		const atMs = this.session.now;
		const input = this.monitor.observeInput({ atMs, kind });
		this.monitor.recordChange({
			atMs,
			input,
			kind,
			replacements: [{ position, deleteCount, insertedText }],
		});
	}

	/// A keystroke that inserts `chars` at the cursor.
	type(chars: string): void {
		this.wait(this.keyGap());
		this.change("typing", this.cursor, 0, chars);
		this.cursor += chars.length;
		this.typed += chars.length;
	}

	/// Backspace over `count` characters as one edit, as editors delete an indent.
	backspace(count = 1): void {
		this.wait(this.rng.between(90, 180));
		this.change("delete", this.cursor - count, count, "");
		this.cursor -= count;
	}

	paste(chars: string): void {
		this.wait(this.rng.between(300, 1200));
		this.change("paste", this.cursor, 0, chars);
		this.cursor += chars.length;
		this.pasted += chars.length;
	}

	/// Selects `count` characters at `position` and deletes them in one change.
	deleteRange(position: number, count: number): void {
		this.wait(this.rng.between(500, 1400));
		this.change("delete", position, count, "");
		this.cursor = position;
	}

	/// Moves the cursor with the mouse or the arrows; no edit.
	jump(to: number): void {
		this.wait(this.rng.between(400, 1800));
		this.cursor = Math.max(0, Math.min(this.text.length, to));
	}

	/// Types `chars` with the occasional typo, noticed a few keys later.
	typeChars(chars: string, typoRate: number): void {
		let i = 0;
		while (i < chars.length) {
			const ch = chars[i] as string;
			if (/[a-z]/.test(ch) && this.rng.chance(typoRate)) {
				const wrong = this.rng.pick("abcdefghijklmnopqrstuvwxyz".split(""));
				this.type(wrong);
				const extra = Math.min(chars.length - i - 1, this.rng.int(0, 2));
				for (let k = 1; k <= extra; k++) this.type(chars[i + k] as string);
				this.wait(this.rng.between(150, 700));
				for (let k = 0; k <= extra; k++) this.backspace();
				continue;
			}
			this.type(ch);
			i++;
		}
	}
}

//
// Texts
//

const WORDS =
	"de a o que e do da em um para com uma os no se na por mais as dos como mas foi ao ele das tem seu sua ou ser quando muito há nos já está eu também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele tu te vocês vos lhes meus minhas teu tua teus tuas nosso nossa nossos nossas dela delas esta estes estas aquele aquela aqueles aquelas isto aquilo estou está estamos estão estive esteve estivemos estiveram estava estávamos estavam estivera estivéramos esteja estejamos estejam estivesse estivéssemos estivessem estiver estivermos estiverem hei há havemos hão houve houvemos houveram houvera houvéramos haja hajamos hajam houvesse houvéssemos houvessem houver houvermos houverem houverei houverá houveremos houverão houveria houveríamos houveriam sou somos são era éramos eram fui foi fomos foram fora fôramos seja sejamos sejam fosse fôssemos fossem for formos forem serei será seremos serão seria seríamos seriam tenho tem temos tém tinha tínhamos tinham tive teve tivemos tiveram tivera tivéramos tenha tenhamos tenham tivesse tivéssemos tivessem tiver tivermos tiverem terei terá teremos terão teria teríamos teriam".split(
		" ",
	);

/// Sentences of 7 to 16 words; `count` words in all.
function essayText(rng: Rng, count: number): string[] {
	const out: string[] = [];
	let left = 0;
	let capital = true;
	while (out.length < count) {
		if (left === 0) left = rng.int(7, 16);
		let word = rng.pick(WORDS);
		if (capital) word = word[0]?.toUpperCase() + word.slice(1);
		left--;
		capital = false;
		if (left === 0) {
			word += ".";
			capital = true;
		}
		out.push(word);
	}
	return out;
}

/// Types an essay with typos, pauses to think and revisions of earlier words.
function writeEssay(
	typist: Typist,
	rng: Rng,
	words: string[],
	options: { think: number; typoRate: number; reviseRate: number },
): void {
	for (const [i, word] of words.entries()) {
		typist.typeChars(`${word} `, options.typoRate);
		if (word.endsWith(".")) {
			typist.wait(rng.between(1500, 6000) * options.think);
			if (rng.chance(options.reviseRate)) reviseWord(typist, rng);
		} else if (rng.chance(0.02 * options.think)) {
			typist.wait(rng.between(1000, 4000) * options.think);
		}
		if (i % 60 === 59) typist.wait(rng.between(10_000, 30_000) * options.think);
	}
}

/// Goes back to an earlier word, replaces or deletes it, and returns to the end.
function reviseWord(typist: Typist, rng: Rng): void {
	const text = typist.text;
	const starts = [...text.matchAll(/\b[\p{L}]{3,}\b/gu)];
	if (starts.length === 0) return;
	const hit = rng.pick(starts);
	const at = hit.index ?? 0;
	typist.jump(at);
	if (rng.chance(0.5)) {
		typist.deleteRange(at, hit[0].length);
		typist.typeChars(rng.pick(WORDS), 0.01);
	} else {
		typist.typeChars(`${rng.pick(WORDS)} `, 0.01);
	}
	typist.wait(rng.between(500, 1500));
	typist.jump(typist.text.length);
}

//
// Code
//

const NAMES = [
	"total",
	"items",
	"user",
	"count",
	"result",
	"index",
	"value",
	"name",
	"list",
	"data",
	"node",
	"limit",
];
const FUNCS = ["compute", "parse", "filter", "update", "render", "load", "sum"];

interface CodeLine {
	indent: number;
	text: string;
	/// Whether the editor indents the next line one level deeper.
	opens: boolean;
}

function codeLines(rng: Rng, count: number): CodeLine[] {
	const lines: CodeLine[] = [];
	let depth = 0;
	while (lines.length < count) {
		const a = rng.pick(NAMES);
		const b = rng.pick(NAMES);
		const f = rng.pick(FUNCS);
		if (depth > 0 && rng.chance(0.22)) {
			depth--;
			lines.push({ indent: depth, text: "}", opens: false });
			continue;
		}
		const options: [string, boolean][] = [
			[`const ${a} = ${f}(${b}, ${rng.int(1, 99)});`, false],
			[`let ${a} = [];`, false],
			[`${a}.push(${f}(${b}));`, false],
			[`console.log("${a}: " + ${b});`, false],
			[`// ${rng.pick(WORDS)} ${rng.pick(WORDS)} ${rng.pick(WORDS)}`, false],
			[`return ${a}[${rng.int(0, 9)}];`, false],
			[`function ${f}(${a}, ${b}) {`, true],
			[`for (let i = 0; i < ${a}.length; i++) {`, true],
			[`if (${a} > ${rng.int(0, 50)}) {`, true],
		];
		const [text, opens] = rng.pick(options);
		lines.push({ indent: depth, text, opens });
		if (opens) depth++;
	}
	while (depth > 0) {
		depth--;
		lines.push({ indent: depth, text: "}", opens: false });
	}
	return lines;
}

const CLOSERS: Record<string, string> = { "(": ")", "[": "]", '"': '"' };

/// Types one line the way CodeMirror does: pairs of brackets and quotes, closers typed over.
function typeCodeLine(typist: Typist, text: string, typoRate: number): void {
	for (const ch of text) {
		const { rng } = typist;
		const next = typist.text[typist.cursor];
		if (')]"'.includes(ch) && next === ch) {
			typist.wait(rng.between(60, 160));
			typist.cursor += 1;
			continue;
		}
		const closer = CLOSERS[ch];
		if (closer) {
			typist.type(ch + closer);
			typist.cursor -= 1;
			continue;
		}
		typist.typeChars(ch, typoRate);
	}
}

/// A pasted block of boilerplate, 6 to 12 lines.
function pastedBlock(rng: Rng): string {
	const lines = codeLines(rng, rng.int(6, 12)).map(
		(line) => `${"  ".repeat(line.indent)}${line.text}`,
	);
	return `${lines.join("\n")}\n`;
}

/// Types a program line by line with revisits to earlier lines and a few pastes.
function writeCode(
	typist: Typist,
	rng: Rng,
	lineCount: number,
	options: { think: number; pastes: number; revisitRate: number },
): void {
	const lines = codeLines(rng, lineCount);
	const pasteAt = new Set<number>();
	while (pasteAt.size < options.pastes) {
		pasteAt.add(rng.int(5, Math.max(6, lineCount - 5)));
	}
	for (const [i, line] of lines.entries()) {
		const previous = lines[i - 1];
		const auto = previous ? previous.indent + (previous.opens ? 1 : 0) : 0;
		if (i > 0) {
			typist.type(`\n${"  ".repeat(auto)}`);
			if (auto > line.indent) typist.backspace(2 * (auto - line.indent));
		}
		typeCodeLine(typist, line.text, 0.02);
		typist.wait(rng.between(800, 5000) * options.think);
		if (i % 9 === 8) typist.wait(rng.between(10_000, 40_000) * options.think);
		if (pasteAt.has(i)) {
			typist.type("\n");
			typist.paste(pastedBlock(rng));
			typist.wait(rng.between(3000, 9000) * options.think);
		}
		if (rng.chance(options.revisitRate)) revisitCode(typist, rng);
	}
}

/// A few small fixes in earlier lines, then back to the end.
function revisitCode(typist: Typist, rng: Rng): void {
	for (let k = rng.int(1, 3); k > 0; k--) {
		const text = typist.text;
		const at = rng.int(0, Math.max(0, text.length - 1));
		typist.jump(at);
		if (rng.chance(0.5)) typist.typeChars(rng.pick(NAMES).slice(0, 4), 0);
		else typist.deleteRange(at, Math.min(rng.int(1, 5), text.length - at));
		typist.wait(rng.between(600, 2500));
	}
	typist.jump(typist.text.length);
}

//
// Profiles
//

interface Simulation {
	flushes: Flush[];
	durationMs: number;
	/// Slugs the profile writes, in order; the first is a text essay.
	fields: string[];
	finalChars: number;
	pastedChars: number;
	words: number;
}

type Profile = "a" | "b" | "c" | "d" | "e";

function simulate(profile: Profile, seed: number): Simulation {
	const rng = new Rng(seed);
	const session = new Session(rng);
	const fields: string[] = [];
	let words = 0;
	const field = (slug: string, keyMs: number) => {
		fields.push(slug);
		return session.newTypist(slug, keyMs);
	};

	if (profile === "a") {
		const typist = field("f0", 170);
		words = 300;
		writeEssay(typist, rng, essayText(rng, words), {
			think: 0.5,
			typoRate: 0.03,
			reviseRate: 0.15,
		});
	} else if (profile === "b") {
		const typist = field("f0", 260);
		writeCode(typist, rng, 60, { think: 1, pastes: 3, revisitRate: 0.3 });
	} else if (profile === "c" || profile === "e") {
		// "c" is an active student; "e" types without stopping and edits a lot.
		const heavy = profile === "e";
		const kinds = ["essay", "code", "essay", "essay", "code"] as const;
		const typists = kinds.map((_, i) => field(`f${i}`, heavy ? 150 : 200));
		const think = heavy ? 0.4 : 1.1;
		for (const [i, kind] of kinds.entries()) {
			const typist = typists[i] as Typist;
			session.advance(rng.between(20_000, heavy ? 40_000 : 90_000)); // reads the question
			if (kind === "essay") {
				const n = heavy ? rng.int(300, 420) : rng.int(180, 320);
				words += n;
				writeEssay(typist, rng, essayText(rng, n), {
					think,
					typoRate: heavy ? 0.06 : 0.03,
					reviseRate: heavy ? 0.3 : 0.12,
				});
			} else {
				writeCode(typist, rng, heavy ? rng.int(60, 90) : rng.int(30, 55), {
					think: think * 1.5,
					pastes: heavy ? 3 : 1,
					revisitRate: heavy ? 0.5 : 0.3,
				});
			}
		}
		// The review pass: read every answer again and fix small things.
		for (const typist of typists) {
			session.advance(rng.between(20_000, 60_000));
			for (let k = rng.int(3, 8); k > 0; k--) {
				if (typist.text.length < 10) break;
				const at = rng.int(0, typist.text.length - 5);
				typist.jump(at);
				if (rng.chance(0.5)) typist.typeChars(rng.pick(WORDS), 0.01);
				else typist.deleteRange(at, rng.int(1, 6));
				typist.wait(rng.between(3000, 15_000));
			}
			typist.jump(typist.text.length);
		}
		// Stays in the exam until the clock runs out.
		const target = 88 * 60_000;
		if (session.now < target) session.advance(target - session.now);
	} else {
		// RFC reference envelope: 10 entries per second, none grouped, 90 minutes.
		const typist = field("f0", 100);
		const total = 54_000;
		for (let i = 0; i < total; i++) {
			typist.cursor = rng.int(0, typist.text.length);
			typist.type("x");
		}
	}
	session.finish();
	const all = [...session.typists.values()];
	return {
		flushes: session.flushes,
		durationMs: session.now,
		fields,
		finalChars: all.reduce((sum, t) => sum + t.text.length, 0),
		pastedChars: all.reduce((sum, t) => sum + t.pasted, 0),
		words,
	};
}

//
// Storing a simulation
//

/// A world with as many followed essays as the profile needs: `text`, `code` and extras.
async function worldFor(fields: number): Promise<World> {
	return support.makeWorld({
		durationMinutes: 240,
		extraEssays: Math.max(0, fields - 2),
	});
}

function slugOf(world: World, index: number): string {
	return [world.slugs.text, world.slugs.code, ...world.slugs.extra][
		index
	] as string;
}

/// Sends every flush of `sim` to the service, one call per flush, and returns the call durations.
async function store(world: World, sim: Simulation): Promise<number[]> {
	const durations: number[] = [];
	for (const flush of sim.flushes) {
		const fields = flush.items.map((item) => ({
			question: slugOf(world, sim.fields.indexOf(item.slug)),
			field: "answer",
			batch: item.batch,
		}));
		const t0 = performance.now();
		const { results } = await support.send(world, fields);
		durations.push(performance.now() - t0);
		for (const result of results) {
			if (result.kind !== "accepted") {
				throw new Error(`Batch refused: ${JSON.stringify(result)}`);
			}
		}
	}
	return durations;
}

/// Bytes the answer-edit tables and their indexes hold: allocated pages and payload.
async function usage(): Promise<{ alloc: number; payload: number }> {
	const rows = await prisma.$queryRawUnsafe<
		{ alloc: number | bigint | null; payload: number | bigint | null }[]
	>(
		"SELECT SUM(pgsize) AS alloc, SUM(payload) AS payload FROM dbstat WHERE name LIKE '%AnswerEdit%'",
	);
	return {
		alloc: Number(rows[0]?.alloc ?? 0),
		payload: Number(rows[0]?.payload ?? 0),
	};
}

//
// Command: sizes
//

const PROFILE_LABEL: Record<Profile, string> = {
	a: "(a) essay, 300 words, ~40 wpm",
	b: "(b) code, 60 lines, pastes",
	c: "(c) exam 90 min, 5 open questions",
	d: "(d) RFC envelope, 10 edits/s, 90 min",
	e: "(e) heavy exam: non-stop typing, 30% revisions, 6% typos",
};

async function sizes(): Promise<void> {
	const KIB = 1024;
	for (const profile of ["a", "b", "c", "e", "d"] as Profile[]) {
		const runs = profile === "d" ? Math.min(3, RUNS) : RUNS;
		const rows: Record<string, number[]> = {
			minutes: [],
			wpm: [],
			edits: [],
			batches: [],
			calls: [],
			bytes: [],
			bytesPerHour: [],
			editsPerHour: [],
			payload: [],
			alloc: [],
			perCall: [],
			editsPerBatch: [],
			tooBig: [],
			snapshotShare: [],
			chars: [],
			sessionWords: [],
		};
		for (let seed = 1; seed <= runs; seed++) {
			const sim = simulate(profile, seed * 7919);
			const world = await worldFor(sim.fields.length);
			const before = await usage();
			await store(world, sim);
			const after = await usage();
			const history = await prisma.answerEditHistory.findUniqueOrThrow({
				where: { responseId: world.attempt.id },
			});
			const batches = await prisma.answerEditBatch.count({
				where: { field: { historyId: history.id } },
			});
			const hours = sim.durationMs / 3_600_000;
			rows.minutes?.push(sim.durationMs / 60_000);
			if (sim.words > 0) rows.wpm?.push(sim.words / (sim.durationMs / 60_000));
			rows.edits?.push(history.editCount);
			rows.batches?.push(batches);
			rows.calls?.push(sim.flushes.length);
			rows.bytes?.push(history.byteCount);
			rows.bytesPerHour?.push(history.byteCount / hours);
			rows.editsPerHour?.push(history.editCount / hours);
			rows.payload?.push(after.payload - before.payload);
			rows.alloc?.push(after.alloc - before.alloc);
			rows.editsPerBatch?.push(history.editCount / batches);
			rows.perCall?.push(history.byteCount / sim.flushes.length);
			rows.tooBig?.push(history.incompleteAt ? 1 : 0);
			const snapshots = sim.flushes.reduce(
				(sum, f) =>
					sum +
					f.items.reduce(
						(s2, i) => s2 + Buffer.byteLength(i.batch.snapshot),
						0,
					),
				0,
			);
			rows.snapshotShare?.push((100 * snapshots) / history.byteCount);
			rows.chars?.push(sim.finalChars);
			rows.sessionWords?.push(sim.words);
		}
		console.log(`\n== ${PROFILE_LABEL[profile]}  (${runs} runs)`);
		const r = (key: string) => rows[key] as number[];
		line("session length", r("minutes"), "min");
		if (profile !== "d" && r("wpm").length > 0) {
			line("net words per minute", r("wpm"), "wpm");
		}
		line("final text, all answers", r("chars"), "chars", 0);
		line("edits stored", r("edits"), "edits", 0);
		line("batches stored", r("batches"), "batches", 0);
		line("edits per batch", r("editsPerBatch"), "edits", 1);
		line(
			"sum of byteCount (limit 4096 KiB)",
			r("bytes").map((v) => v / KIB),
			"KiB",
		);
		line("byteCount per batch", r("perCall"), "B", 0);
		line("snapshot share of byteCount", r("snapshotShare"), "%");
		line(
			"byteCount per student-hour",
			r("bytesPerHour").map((v) => v / KIB),
			"KiB/h",
		);
		line("edits per student-hour", r("editsPerHour"), "edits/h", 0);
		line(
			"SQLite payload (tables + indexes)",
			r("payload").map((v) => v / KIB),
			"KiB",
		);
		line(
			"SQLite allocated pages",
			r("alloc").map((v) => v / KIB),
			"KiB",
		);
		const edits = stats(r("edits"));
		const bytes = stats(r("bytes"));
		console.log(
			`vs limits: edits ${fmt((100 * edits.max) / constants.MAX_ANSWER_HISTORY_ATTEMPT_EDITS, 1)}% of 100000 (max), bytes ${fmt((100 * bytes.max) / constants.MAX_ANSWER_HISTORY_ATTEMPT_BYTES, 1)}% of 4 MiB (max), incomplete runs ${r("tooBig").reduce((a, b) => a + b, 0)}`,
		);
		const bytesMed = bytes.med;
		console.log(
			`100 students (median): ${fmt((100 * bytesMed) / (KIB * KIB), 2)} MiB of byteCount; 250 students: ${fmt((250 * bytesMed) / (KIB * KIB), 2)} MiB`,
		);
	}
}

//
// Command: cost
//

/// The CPU work `append` does outside the transaction for a batch, piece by piece.
function validationPieces(batch: Batch, start: string): Record<string, number> {
	const raw = { question: "q", field: "answer", batch };
	const t0 = performance.now();
	const bytes = Buffer.byteLength(JSON.stringify(raw));
	const envelope = answerEditItemEnvelope.safeParse(raw);
	const batchBytes = Buffer.byteLength(
		JSON.stringify({ question: "q", field: "answer", batch }),
	);
	const t1 = performance.now();
	const parsed = answerEditBatchInput.safeParse(batch);
	const t2 = performance.now();
	const hash = batchContentHash(batch);
	const t3 = performance.now();
	const replay = replayBatch(batch.base?.text ?? start, batch);
	const same = replay.ok && replay.text === batch.snapshot;
	const sizes =
		Buffer.byteLength(batch.snapshot) +
		(batch.base ? Buffer.byteLength(batch.base.text) : 0);
	const t4 = performance.now();
	if (
		!envelope.success ||
		!parsed.success ||
		!same ||
		!hash ||
		!bytes ||
		!batchBytes ||
		sizes < 0
	) {
		throw new Error("The batch under measurement is not valid");
	}
	return {
		measure: t1 - t0,
		parse: t2 - t1,
		hash: t3 - t2,
		replay: t4 - t3,
		total: t4 - t0,
	};
}

/// A chain of `count` batches of `edits` replacements over a text of `size` characters.
function chain(
	rng: Rng,
	options: { size: number; edits: number; count: number; replace: number },
): Batch[] {
	let text = "abcdefghij"
		.repeat(Math.ceil(options.size / 10))
		.slice(0, options.size);
	const start = text;
	const batches: Batch[] = [];
	let seq = 0;
	for (let k = 0; k < options.count; k++) {
		const steps = [];
		let current = text;
		for (let i = 0; i < options.edits; i++) {
			const position = rng.int(0, current.length - options.replace);
			const insertedText = String.fromCharCode(97 + rng.int(0, 25)).repeat(
				options.replace,
			);
			steps.push({
				position,
				deleteCount: options.replace,
				insertedText,
				startMs: 1000 + seq + i * 100,
				durationMs: 0,
			});
			current =
				current.slice(0, position) +
				insertedText +
				current.slice(position + options.replace);
		}
		batches.push(
			support.makeBatch({
				start: text,
				steps,
				baseRevision: k,
				firstSeq: seq,
				sessionId: "measure",
				timeOriginMs: 0,
				...(k === 0
					? { base: { reason: "start" as const, text: start } }
					: { base: "none" as const }),
			}),
		);
		text = current;
		seq += options.edits;
	}
	return batches;
}

/// Counts what happens inside the interactive transactions the service opens.
const tagStore = new AsyncLocalStorage<string>();
const txLog: Record<string, { total: number[]; inner: number[] }> = {};

function instrumentTransactions(): void {
	const original = prisma.$transaction.bind(prisma) as (
		fn: unknown,
		...rest: unknown[]
	) => Promise<unknown>;
	(prisma as unknown as { $transaction: unknown }).$transaction = async (
		fn: unknown,
		...rest: unknown[]
	) => {
		const tag = tagStore.getStore() ?? "other";
		const t0 = performance.now();
		let inner0 = t0;
		let inner1 = t0;
		const wrapped =
			typeof fn === "function"
				? async (tx: unknown) => {
						inner0 = performance.now();
						try {
							return await (fn as (tx: unknown) => Promise<unknown>)(tx);
						} finally {
							inner1 = performance.now();
						}
					}
				: fn;
		try {
			return await original(wrapped, ...rest);
		} finally {
			txLog[tag] ??= { total: [], inner: [] };
			const log = txLog[tag] as (typeof txLog)[string];
			log.total.push(performance.now() - t0);
			log.inner.push(inner1 - inner0);
		}
	};
}

async function cost(): Promise<void> {
	instrumentTransactions();
	// Typical batches: what the page sends at each flush of profile (a).
	const typical: { batch: Batch; start: string }[] = [];
	for (let seed = 1; seed <= 20; seed++) {
		const sim = simulate("a", seed * 7919);
		let text = "";
		for (const flush of sim.flushes) {
			for (const item of flush.items) {
				typical.push({ batch: item.batch, start: text });
				text = item.batch.snapshot;
			}
		}
	}
	const warm = typical.slice(0, 20);
	for (const { batch, start } of warm) validationPieces(batch, start);

	console.log("\n== validation CPU, outside the transaction (no database)");
	const typicalRuns: Record<string, number[]> = {};
	for (const { batch, start } of typical) {
		for (let r = 0; r < 20; r++) {
			for (const [k, v] of Object.entries(validationPieces(batch, start))) {
				typicalRuns[k] = [...(typicalRuns[k] ?? []), v];
			}
		}
	}
	const edits = typical.map((t) => t.batch.edits.length);
	console.log(
		`typical batch of profile (a): ${typical.length} batches, edits med ${fmt(stats(edits).med, 0)} max ${stats(edits).max}, JSON med ${fmt(stats(typical.map((t) => JSON.stringify(t.batch).length)).med, 0)} B`,
	);
	for (const k of ["measure", "parse", "hash", "replay", "total"]) {
		line(`typical ${k}`, typicalRuns[k] as number[], "ms", 3);
	}

	const variants = [
		{
			name: "max count: 5000 x 1 char over 120 KB",
			size: 120_000,
			edits: 5000,
			replace: 1,
			count: 8,
		},
		{
			name: "max bytes: 5000 x 50 chars over 60 KB",
			size: 60_000,
			edits: 5000,
			replace: 50,
			count: 6,
		},
		{
			name: "5000 x 1 char over 4 KB",
			size: 4000,
			edits: 5000,
			replace: 1,
			count: 8,
		},
	];
	const rng = new Rng(42);
	for (const variant of variants) {
		const batches = chain(rng, variant);
		const bytes = batches.map((b) => Buffer.byteLength(JSON.stringify(b)));
		console.log(
			`\n== ${variant.name}: batch JSON ${fmt(Math.min(...bytes) / 1024, 0)} to ${fmt(Math.max(...bytes) / 1024, 0)} KiB (limit 512)`,
		);
		// CPU pieces, against the text each batch starts from.
		const pieces: Record<string, number[]> = {};
		let text = batches[0]?.base?.text ?? "";
		for (const batch of batches) {
			for (let r = 0; r < 15; r++) {
				for (const [k, v] of Object.entries(validationPieces(batch, text))) {
					pieces[k] = [...(pieces[k] ?? []), v];
				}
			}
			text = batch.snapshot;
		}
		for (const k of ["measure", "parse", "hash", "replay", "total"]) {
			line(`${k}`, pieces[k] as number[], "ms", 2);
		}
		// Through the service, to a database, with the transaction timed apart.
		const totals: number[] = [];
		const outside: number[] = [];
		const worlds = 3;
		for (let w = 0; w < worlds; w++) {
			const world = await worldFor(2);
			for (const batch of batches) {
				const before = txLog.history?.total.length ?? 0;
				const t0 = performance.now();
				const result = await tagStore.run("history", () =>
					support.sendBatch(world, batch),
				);
				const elapsed = performance.now() - t0;
				if (result.kind !== "accepted") {
					throw new Error(`Refused: ${JSON.stringify(result)}`);
				}
				const txMs = txLog.history?.total[before] ?? 0;
				totals.push(elapsed);
				outside.push(elapsed - txMs);
			}
			// The same chain restarts on the next world.
		}
		line("append, whole call", totals, "ms", 2);
		line("append, outside the transaction", outside, "ms", 2);
		line(
			"append, transaction (call to commit)",
			txLog.history?.total ?? [],
			"ms",
			2,
		);
		line(
			"append, transaction (callback only)",
			txLog.history?.inner ?? [],
			"ms",
			2,
		);
		txLog.history = { total: [], inner: [] };
	}

	// Typical batches, through the service, against the clock of the transaction.
	console.log("\n== typical batches of profile (a) through the service");
	const totals: number[] = [];
	const outside: number[] = [];
	txLog.history = { total: [], inner: [] };
	for (let seed = 1; seed <= 10; seed++) {
		const sim = simulate("a", seed * 7919);
		const world = await worldFor(2);
		for (const flush of sim.flushes) {
			const before = txLog.history.total.length;
			const t0 = performance.now();
			const item = flush.items[0] as Flush["items"][number];
			const result = await tagStore.run("history", () =>
				support.sendBatch(world, item.batch),
			);
			const elapsed = performance.now() - t0;
			if (result.kind !== "accepted") throw new Error("refused");
			totals.push(elapsed);
			outside.push(elapsed - (txLog.history.total[before] ?? 0));
		}
	}
	line("append, whole call", totals, "ms", 2);
	line("append, outside the transaction", outside, "ms", 2);
	line(
		"append, transaction (call to commit)",
		txLog.history?.total ?? [],
		"ms",
		2,
	);
	line(
		"append, transaction (callback only)",
		txLog.history?.inner ?? [],
		"ms",
		2,
	);
}

//
// Command: load
//

/// Students of one exam, each with an attempt and a chain of typical batches.
async function classOf(n: number) {
	const world = await worldFor(2);
	const students = [{ student: world.student, attempt: world.attempt }];
	for (let i = 1; i < n; i++) students.push(await support.otherAttempt(world));
	return { world, students };
}

async function answer(world: World, actor: World["student"], text: string) {
	const t0 = performance.now();
	await db.response.submit(
		{
			course: world.course.id,
			exam: world.exam.slug,
			question: world.slugs.text,
			payload: text,
		},
		{ actor },
	);
	return performance.now() - t0;
}

async function historyAppend(
	world: World,
	member: { student: World["student"]; attempt: World["attempt"] },
	batch: Batch,
) {
	const t0 = performance.now();
	const { results } = await tagStore.run("history", () =>
		db.answerEdit.append(
			{
				course: world.course.id,
				exam: world.exam.slug,
				attempt: member.attempt.publicId,
				fields: [{ question: world.slugs.text, field: "answer", batch }],
			},
			{ actor: member.student },
		),
	);
	const kind = results[0]?.kind;
	if (kind !== "accepted")
		throw new Error(`Refused: ${JSON.stringify(results)}`);
	return performance.now() - t0;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/// A chain of `count` typical batches (profile (a) sized) for one student.
function typicalChain(seed: number): Batch[] {
	const sim = simulate("a", seed * 104729);
	return sim.flushes.map(
		(flush) => (flush.items[0] as Flush["items"][number]).batch,
	);
}

/// Class sizes of the load scenarios; the ADR 0009 target is 250.
const SIZES = [10, 50, 100, 250];

/// Whether the part of `load` named on the command line (or all of them) runs.
const want = (part: string) => !positionals[1] || positionals[1] === part;

async function load(): Promise<void> {
	instrumentTransactions();
	const chains = Array.from({ length: 10 }, (_, i) => typicalChain(i + 1));
	const rounds = Math.min(...chains.map((c) => c.length));
	const text = "Uma resposta curta de uma questão aberta. ".repeat(40);

	for (const n of want("herd") ? SIZES : []) {
		const { world, students } = await classOf(n);
		console.log(
			`\n== ${n} students, ${rounds} rounds: all send at the same instant`,
		);
		const baseline: number[] = [];
		const loaded: number[] = [];
		const history: number[] = [];
		for (let r = 0; r < rounds; r++) {
			baseline.push(
				...(await Promise.all(
					students.map((s) => answer(world, s.student, `${text}${r}`)),
				)),
			);
			await sleep(200);
			const calls: Promise<number>[] = [];
			const kinds: string[] = [];
			for (const [i, s] of students.entries()) {
				const batch = (chains[i % chains.length] as Batch[])[r] as Batch;
				const order = (i + r) % 2 === 0;
				const a = () => {
					kinds.push("a");
					return answer(world, s.student, `${text}${r}`);
				};
				const h = () => {
					kinds.push("h");
					return historyAppend(world, s, batch);
				};
				if (order) calls.push(a(), h());
				else calls.push(h(), a());
			}
			const out = await Promise.all(calls);
			for (const [i, ms] of out.entries()) {
				(kinds[i] === "a" ? loaded : history).push(ms);
			}
			await sleep(200);
		}
		line("exam.answer alone", baseline, "ms");
		line("exam.answer with a history append each", loaded, "ms");
		line("history append (concurrent with answers)", history, "ms");
		line(
			"history transaction (call to commit)",
			txLog.history?.total ?? [],
			"ms",
			2,
		);
		txLog.history = { total: [], inner: [] };
	}

	for (const n of want("paced") ? SIZES : []) {
		const { world, students } = await classOf(n);
		const seconds = 4;
		console.log(
			`\n== ${n} students paced at 60x the real rate (append every 1 s, answer every 2 s), 3 x (${seconds} s alone, ${seconds} s with history)`,
		);
		const states = students.map(() => ({ seq: 0, text: "" }));
		const run = async (withHistory: boolean) => {
			const answers: number[] = [];
			const appends: number[] = [];
			const end = performance.now() + seconds * 1000;
			await Promise.all(
				students.map(async (s, i) => {
					const rng = new Rng(i + 1);
					const state = states[i] as (typeof states)[number];
					await sleep(rng.between(0, 1000));
					const histLoop = async () => {
						while (performance.now() < end) {
							const batch = support.appendBatch(state.text, "ab", {
								baseRevision: state.seq,
								firstSeq: state.seq * 2,
								sessionId: "paced",
								...(state.seq === 0
									? { base: { reason: "start" as const, text: "" } }
									: { base: "none" as const }),
							});
							appends.push(await historyAppend(world, s, batch));
							state.text = batch.snapshot;
							state.seq++;
							await sleep(1000);
						}
					};
					const answerLoop = async () => {
						while (performance.now() < end) {
							answers.push(await answer(world, s.student, `${text}${i}`));
							await sleep(2000);
						}
					};
					await Promise.all(
						withHistory ? [histLoop(), answerLoop()] : [answerLoop()],
					);
				}),
			);
			return { answers, appends };
		};
		const alone: number[] = [];
		const together: number[] = [];
		const appends: number[] = [];
		txLog.history = { total: [], inner: [] };
		for (let segment = 0; segment < 3; segment++) {
			alone.push(...(await run(false)).answers);
			const mixed = await run(true);
			together.push(...mixed.answers);
			appends.push(...mixed.appends);
		}
		line("exam.answer alone", alone, "ms");
		line("exam.answer with history traffic", together, "ms");
		line("history append", appends, "ms");
		line(
			"history transaction (call to commit)",
			txLog.history?.total ?? [],
			"ms",
			2,
		);
		txLog.history = { total: [], inner: [] };
	}

	for (const n of want("storm") ? SIZES : []) {
		const { world, students } = await classOf(n);
		console.log(
			`\n== reconnect storm: ${n} students send a 5000-edit backlog at once; a probe answers every 20 ms`,
		);
		const rng = new Rng(7);
		const backlog = students.map(() => {
			const steps = [];
			let length = 0;
			for (let i = 0; i < 5000; i++) {
				steps.push({
					position: rng.int(0, length),
					deleteCount: 0,
					insertedText: "x",
					startMs: 1000 + i * 100,
					durationMs: 0,
				});
				length++;
			}
			return support.makeBatch({
				start: "",
				steps,
				sessionId: "storm",
				timeOriginMs: 0,
			});
		});
		const probe: number[] = [];
		let running = true;
		const prober = (async () => {
			const s = students[0] as (typeof students)[number];
			while (running) {
				probe.push(await answer(world, s.student, "probe"));
				await sleep(20);
			}
		})();
		const t0 = performance.now();
		const times = await Promise.all(
			students.map((s, i) => historyAppend(world, s, backlog[i] as Batch)),
		);
		const drain = performance.now() - t0;
		running = false;
		await prober;
		line("history append (each)", times, "ms");
		console.log(`all ${n} backlogs stored in ${fmt(drain, 0)} ms`);
		line("probe exam.answer during the storm", probe, "ms");
		line(
			"history transaction (call to commit)",
			txLog.history?.total ?? [],
			"ms",
			2,
		);
		txLog.history = { total: [], inner: [] };
	}
}

//
// Command: summary
//

async function timeSummary(world: World, label: string, runs: number) {
	const call = () =>
		db.answerEdit.summary(
			{
				course: world.course.id,
				exam: world.exam.slug,
				author: world.student.username,
			},
			{ actor: world.instructor },
		);
	for (let i = 0; i < 3; i++) await call();
	const total: number[] = [];
	let result: Awaited<ReturnType<typeof call>> | undefined;
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		result = await call();
		total.push(performance.now() - t0);
	}
	const read: number[] = [];
	for (let i = 0; i < runs; i++) {
		const t0 = performance.now();
		await prisma.answerEditField.findMany({
			where: { history: { responseId: world.attempt.id } },
			select: {
				batches: {
					orderBy: { revision: "asc" },
					select: {
						edits: true,
						baseText: true,
						gapBefore: true,
						receivedAt: true,
						sessionId: true,
						timeOriginMs: true,
						baseReason: true,
					},
				},
			},
		});
		read.push(performance.now() - t0);
	}
	line(`${label}: summary()`, total, "ms");
	line(`${label}: reading the batches alone`, read, "ms");
	return result;
}

async function summaryCommand(): Promise<void> {
	// Profile (c).
	const sim = simulate("c", 7919);
	const world = await worldFor(sim.fields.length);
	await store(world, sim);
	const history = await prisma.answerEditHistory.findUniqueOrThrow({
		where: { responseId: world.attempt.id },
	});
	console.log(
		`\n== profile (c): ${history.editCount} edits, ${fmt(history.byteCount / 1024, 0)} KiB`,
	);
	const result = await timeSummary(world, "profile (c)", 50);
	console.log(`summary JSON: ${Buffer.byteLength(JSON.stringify(result))} B`);

	// An attempt at the limits: 4 MiB with long edits, then 100000 one-character edits.
	const cases = [
		{
			name: "4 MiB: 2000-edit batches of 50-character replacements",
			replace: 50,
			per: 2000,
			size: 100_000,
		},
		{
			name: "100000 edits: one-character replacements",
			replace: 1,
			per: 5000,
			size: 100_000,
		},
	];
	for (const c of cases) {
		const w = await worldFor(2);
		const rng = new Rng(11);
		let text = "abcdefghij".repeat(c.size / 10);
		let seq = 0;
		let k = 0;
		let closed = false;
		while (!closed) {
			const steps = [];
			let current = text;
			for (let i = 0; i < c.per; i++) {
				const position = rng.int(0, current.length - c.replace);
				const insertedText = String.fromCharCode(97 + rng.int(0, 25)).repeat(
					c.replace,
				);
				steps.push({
					position,
					deleteCount: c.replace,
					insertedText,
					startMs: 1000 + seq + i * 100,
					durationMs: 0,
				});
				current =
					current.slice(0, position) +
					insertedText +
					current.slice(position + c.replace);
			}
			const batch = support.makeBatch({
				start: text,
				steps,
				baseRevision: k,
				firstSeq: seq,
				sessionId: "limit",
				timeOriginMs: 0,
				...(k === 0
					? { base: { reason: "start" as const, text } }
					: { base: "none" as const }),
			});
			const r = await support.sendBatch(w, batch);
			if (r.kind !== "accepted") {
				closed = true;
				console.log(`limit reached at batch ${k}: ${JSON.stringify(r)}`);
				break;
			}
			text = current;
			seq += c.per;
			k++;
		}
		const h = await prisma.answerEditHistory.findUniqueOrThrow({
			where: { responseId: w.attempt.id },
		});
		console.log(
			`\n== ${c.name}: ${h.editCount} edits, ${fmt(h.byteCount / 1024, 0)} KiB`,
		);
		const res = await timeSummary(w, c.name.split(":")[0] as string, 15);
		console.log(`summary JSON: ${Buffer.byteLength(JSON.stringify(res))} B`);
	}
}

switch (command) {
	case "sizes":
		await sizes();
		break;
	case "cost":
		await cost();
		break;
	case "load":
		await load();
		break;
	case "summary":
		await summaryCommand();
		break;
	default:
		console.error("usage: measure-answer-history.ts sizes|cost|load|summary");
		process.exitCode = 1;
}

await prisma.$disconnect();
rmSync(dbFile, { force: true });
