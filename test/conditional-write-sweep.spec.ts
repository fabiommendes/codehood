import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { PreconditionFailed } from "@/core/error";
import { db } from "@/db";

/// Sweep of the registered services for ADR 0013: a service that writes a
/// model with `updatedAt` must honor `ServiceOpts.expectedUpdatedAt`, so a new
/// service cannot be added without it.

const WRITES = ["update", "upsert", "delete"] as const;
type Write = (typeof WRITES)[number];

const STALE = new Date(0);
let seq = 0;
const uniq = () => `${++seq}-${Math.random().toString(36).slice(2, 7)}`;

/// Which version a case sends: one that is no longer the row's, or its own.
type Version = "stale" | "current";

/// Services that honor the option. Each write creates its own row and runs
/// with the version asked for: `stale` must reject with `PreconditionFailed`
/// and `current` must write.
const HONORED: Record<
	string,
	Partial<Record<Write, (version: Version) => Promise<unknown>>>
> = {
	discipline: (() => {
		const row = async () => {
			const slug = `sw-d-${uniq()}`;
			return db.discipline.create({ slug, name: slug }, FULL_ACCESS);
		};
		const opts = (d: { updatedAt: Date }, version: Version) => ({
			...FULL_ACCESS,
			expectedUpdatedAt: version === "stale" ? STALE : d.updatedAt,
		});
		return {
			update: async (v) => {
				const d = await row();
				return db.discipline.update(
					{ slug: d.slug },
					{ name: "x" },
					opts(d, v),
				);
			},
			upsert: async (v) => {
				const d = await row();
				return db.discipline.upsert({ slug: d.slug, name: "x" }, opts(d, v));
			},
			delete: async (v) => {
				const d = await row();
				return db.discipline.delete({ slug: d.slug }, opts(d, v));
			},
		};
	})(),
	course: (() => {
		const row = async () => {
			const edition = `${4000 + ++seq}-1`;
			await db.edition.create(
				{
					slug: edition,
					name: edition,
					startAt: new Date("2026-01-01"),
					endAt: new Date("2030-12-31"),
				},
				FULL_ACCESS,
			);
			const discipline = `sw-c-${uniq()}`;
			await db.discipline.create(
				{ slug: discipline, name: discipline },
				FULL_ACCESS,
			);
			const instructor = `sw-i-${uniq()}`;
			await db.user.create(
				{
					email: `${instructor}@codehood.test`,
					username: instructor,
					name: instructor,
					role: "INSTRUCTOR",
					password: "x",
					githubId: instructor,
					schoolId: instructor,
				},
				FULL_ACCESS,
			);
			const startAt = new Date("2026-02-02T00:00:00Z");
			const endAt = new Date("2026-06-01T00:00:00Z");
			const course = await db.course.create(
				{ discipline, instructor, edition, startAt, endAt },
				FULL_ACCESS,
			);
			return {
				course,
				pk: { id: course.id },
				natural: { discipline, instructor, edition, startAt, endAt },
			};
		};
		const opts = (c: { updatedAt: Date }, version: Version) => ({
			...FULL_ACCESS,
			expectedUpdatedAt: version === "stale" ? STALE : c.updatedAt,
		});
		return {
			update: async (v) => {
				const { course, pk } = await row();
				return db.course.update(pk, { description: "x" }, opts(course, v));
			},
			upsert: async (v) => {
				const { course, natural } = await row();
				return db.course.upsert(natural, opts(course, v));
			},
			delete: async (v) => {
				const { course, pk } = await row();
				return db.course.delete(pk, opts(course, v));
			},
		};
	})(),
};

/// Services with writes on a versioned model that do not honor the option
/// yet. Remove a name when its service does; the test fails if it stays.
const PENDING = new Set<string>([
	"calendarEvent",
	"exam",
	"examException",
	"feedback",
	"gradeColumn",
	"question",
	"regradeRequest",
	"report",
	"repository",
	"resource",
	"response",
	"rollCall",
	"rubric",
	"timeSlot",
]);

/// Services outside the rule, with the reason.
const EXEMPT: Record<string, string> = {
	answerEdit:
		"no public update/upsert/delete; append is a compare-and-swap on AnswerEditField.revision",
};

/// Models of `prisma/schema.prisma` that have an `updatedAt` column.
function versionedModels(): Set<string> {
	const models = new Set<string>();
	let current = "";
	for (const line of readFileSync("prisma/schema.prisma", "utf8").split("\n")) {
		const header = line.match(/^model (\w+) \{/);
		if (header) current = header[1] ?? "";
		else if (/^\s+updatedAt\s+DateTime/.test(line)) models.add(current);
	}
	return models;
}

/// The service key that owns a versioned model without a service of its own.
const OWNER: Record<string, string> = {
	QuestionRef: "question",
	RubricItem: "rubric",
	AnswerEditHistory: "answerEdit",
	AnswerEditField: "answerEdit",
};

const ownerOf = (model: string) =>
	OWNER[model] ?? model.charAt(0).toLowerCase() + model.slice(1);

/// Files under `src/db/` that are not scanned. `bootstrap.ts` seeds the dev
/// database, and no service uses it.
const UNSCANNED = new Set(["conditional-write.ts", "bootstrap.ts"]);

function dbSources(dir = "src/db"): { file: string; text: string }[] {
	const found: { file: string; text: string }[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) found.push(...dbSources(path));
		else if (entry.name.endsWith(".ts") && !UNSCANNED.has(entry.name)) {
			const text = readFileSync(path, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/(^|[^:])\/\/.*$/gm, "$1");
			found.push({ file: path, text });
		}
	}
	return found;
}

type WriteSite = { file: string; model: string; raw: boolean };

/// Every write on a versioned model in `src/db/`, wherever the file is and
/// whatever the receiver is called: Prisma calls outside the helper (`raw`)
/// and calls to the helper.
function scanWrites(versioned: Set<string>): WriteSite[] {
	const rawCall =
		/\.([a-z]\w*)\.(?:update|updateMany|upsert|delete|deleteMany)\b/g;
	const helperCall =
		/\b(?:guardedUpdate|guardedDelete|touch)\(\s*\w+,\s*"(\w+)"/g;
	const upper = (delegate: string) =>
		delegate.charAt(0).toUpperCase() + delegate.slice(1);
	const writes: WriteSite[] = [];
	for (const { file, text } of dbSources()) {
		for (const call of text.matchAll(rawCall)) {
			const model = upper(call[1] ?? "");
			if (versioned.has(model)) writes.push({ file, model, raw: true });
		}
		for (const call of text.matchAll(helperCall)) {
			const model = upper(call[1] ?? "");
			if (versioned.has(model)) writes.push({ file, model, raw: false });
		}
	}
	return writes;
}

const kebab = (key: string) =>
	key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const sourceOf = (key: string) =>
	readFileSync(`src/db/services/${kebab(key)}.service.ts`, "utf8");

const writeOps = (key: string): Write[] =>
	WRITES.filter(
		(op) =>
			typeof (db as Record<string, Record<string, unknown>>)[key]?.[op] ===
			"function",
	);

const honorsOption = (key: string) => /conditional-write/.test(sourceOf(key));

const keys = Object.keys(db);

test("every write on a versioned model belongs to an accounted service", () => {
	const writes = scanWrites(versionedModels());
	const unaccounted = new Set<string>();
	const outsideHelper = new Set<string>();
	for (const { file, model, raw } of writes) {
		const owner = ownerOf(model);
		if (owner in EXEMPT) continue;
		if (!(owner in HONORED) && !PENDING.has(owner)) {
			unaccounted.add(`${owner} (model ${model}, ${file})`);
		}
		if (raw && !PENDING.has(owner)) {
			outsideHelper.add(`${file}: ${model} written outside the helper`);
		}
	}
	expect(
		[...unaccounted],
		"add a HONORED entry (or PENDING, temporarily) for these services",
	).toEqual([]);
	expect(
		[...outsideHelper],
		"use guardedUpdate, guardedDelete or touch",
	).toEqual([]);
});

test("PENDING lists only services that still need the option", () => {
	const writes = scanWrites(versionedModels());
	const rotten = [...PENDING].filter(
		(key) =>
			!keys.includes(key) ||
			honorsOption(key) ||
			writeOps(key).length === 0 ||
			!writes.some((w) => w.raw && ownerOf(w.model) === key),
	);
	expect(rotten, "remove these from PENDING").toEqual([]);
});

for (const [key, ops] of Object.entries(HONORED)) {
	test(`${key}: every write rejects a stale expectedUpdatedAt and takes the current one`, async () => {
		expect(honorsOption(key), "the service source never uses the helper").toBe(
			true,
		);
		expect(Object.keys(ops).sort(), "HONORED must cover each write").toEqual(
			writeOps(key).sort(),
		);
		for (const [op, run] of Object.entries(ops)) {
			const stale = await run("stale").catch((e: unknown) => e);
			expect(stale, `${key}.${op} with a stale version`).toBeInstanceOf(
				PreconditionFailed,
			);
			await run("current");
		}
	});
}
