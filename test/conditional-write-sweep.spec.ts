import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { PreconditionFailed } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db } from "@/db";
import {
	enroll,
	makeCourse,
	makeExam,
	makeReport,
	makeResponse,
} from "./conditional-write-exam-support";

/// Sweep of the registered services for ADR 0013: a service that writes a
/// model with `updatedAt` must honor `ServiceOpts.expectedUpdatedAt`, so a new
/// service cannot be added without it.
///
/// The scan reads `src/db/**` as text, so its limits are these:
/// - a delegate chosen at run time (`tx[model]`) is invisible; only the helper
///   module does it, and it is not scanned;
/// - a nested write (`update`, `delete`, `set`... inside a relation of `data`)
///   is flagged by the name of the relation field, in any `data`, so a field
///   name shared by two models is flagged when either of them has `updatedAt`;
/// - raw SQL is read from the first string literal after `$executeRaw` or
///   `$queryRaw`, so a statement built by concatenation is not;
/// - a delegate handed to another function (`save(tx.course)`) is not followed.

const WRITES = ["update", "upsert", "delete"] as const;
type Write = (typeof WRITES)[number];

const STALE = new Date(0);
let seq = 0;
const uniq = () => `${++seq}-${Math.random().toString(36).slice(2, 7)}`;

/// A course with its own edition, discipline and instructor.
async function newCourse() {
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
}

/// The service options of a case: the row's own version, or a stale one.
const opts = (row: { updatedAt: Date }, version: Version) => ({
	...FULL_ACCESS,
	expectedUpdatedAt: version === "stale" ? STALE : row.updatedAt,
});

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
		const row = newCourse;
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
	timeSlot: (() => {
		const input = (course: CourseId, slug: string) => ({
			course,
			slug,
			day: "MONDAY" as const,
			start: { hour: 8, minute: 0 },
			duration: { hours: 1 },
		});
		const row = async () => {
			const { course } = await newCourse();
			const slot = await db.timeSlot.create(
				input(course.id as CourseId, `sw-${uniq()}`),
				FULL_ACCESS,
			);
			return { slot, body: input(course.id as CourseId, slot.slug) };
		};
		return {
			update: async (v) => {
				const { slot } = await row();
				return db.timeSlot.update(
					{ id: slot.id },
					{ title: "x" },
					opts(slot, v),
				);
			},
			upsert: async (v) => {
				const { slot, body } = await row();
				return db.timeSlot.upsert(body, opts(slot, v));
			},
			delete: async (v) => {
				const { slot } = await row();
				return db.timeSlot.delete({ id: slot.id }, opts(slot, v));
			},
		};
	})(),
	calendarEvent: (() => {
		const row = async () => {
			const { course } = await newCourse();
			const slot = await db.timeSlot.create(
				{
					course: course.id as CourseId,
					slug: `sw-${uniq()}`,
					day: "MONDAY",
					start: { hour: 8, minute: 0 },
					duration: { hours: 1 },
				},
				FULL_ACCESS,
			);
			const body = {
				course: course.id as CourseId,
				timeSlot: slot.id,
				week: 1,
				title: "Class",
			};
			return { event: await db.calendarEvent.create(body, FULL_ACCESS), body };
		};
		return {
			update: async (v) => {
				const { event } = await row();
				return db.calendarEvent.update(
					{ id: event.id },
					{ title: "x" },
					opts(event, v),
				);
			},
			upsert: async (v) => {
				const { event, body } = await row();
				return db.calendarEvent.upsert(body, opts(event, v));
			},
			delete: async (v) => {
				const { event } = await row();
				return db.calendarEvent.delete({ id: event.id }, opts(event, v));
			},
		};
	})(),
	resource: (() => {
		const row = async () => {
			const { course } = await newCourse();
			const body = {
				course: course.id as CourseId,
				slug: `sw-${uniq()}`,
				title: "Link",
				data: { type: "LINK" as const, url: "https://example.test/a" },
			};
			return { resource: await db.resource.create(body, FULL_ACCESS), body };
		};
		return {
			update: async (v) => {
				const { resource } = await row();
				return db.resource.update(
					{ id: resource.id },
					{ title: "x" },
					opts(resource, v),
				);
			},
			upsert: async (v) => {
				const { resource, body } = await row();
				return db.resource.upsert(body, opts(resource, v));
			},
			delete: async (v) => {
				const { resource } = await row();
				return db.resource.delete({ id: resource.id }, opts(resource, v));
			},
		};
	})(),
	repository: (() => {
		const row = async () => {
			const { course } = await newCourse();
			const body = { course: course.id as CourseId, slug: `sw-${uniq()}` };
			return {
				repository: await db.repository.create(body, FULL_ACCESS),
				body,
			};
		};
		return {
			upsert: async (v) => {
				const { repository, body } = await row();
				return db.repository.upsert(body, opts(repository, v));
			},
			delete: async (v) => {
				const { repository, body } = await row();
				return db.repository.delete(body, opts(repository, v));
			},
		};
	})(),
	question: (() => {
		const row = async () => {
			const { course } = await newCourse();
			const body = {
				course: course.id as CourseId,
				slug: `sw-${uniq()}`,
				status: "PUBLISHED" as const,
				version: "v1",
				question: {
					type: "multiple-choice" as const,
					title: "Q",
					stem: "Which one?",
					choices: [
						{ id: "x", text: "X", score: 1 },
						{ id: "y", text: "Y" },
					],
				},
			};
			return { question: await db.question.create(body, FULL_ACCESS), body };
		};
		return {
			update: async (v) => {
				const { question } = await row();
				return db.question.update(
					{ id: question.id },
					{ rev: "x" },
					opts(question, v),
				);
			},
			upsert: async (v) => {
				const { question, body } = await row();
				return db.question.upsert(
					{ ...body, version: "v2" },
					opts(question, v),
				);
			},
			delete: async (v) => {
				const { question } = await row();
				return db.question.delete({ id: question.id }, opts(question, v));
			},
		};
	})(),
	gradeColumn: (() => {
		const row = async () => {
			const { course } = await newCourse();
			const body = {
				course: course.id as CourseId,
				slug: `sw-${uniq()}`,
				title: "Col",
				kind: "NUMBER" as const,
				position: 0,
				values: [],
			};
			return { column: await db.gradeColumn.create(body, FULL_ACCESS), body };
		};
		return {
			update: async (v) => {
				const { column } = await row();
				return db.gradeColumn.update(
					{ id: column.id },
					{ title: "x" },
					opts(column, v),
				);
			},
			upsert: async (v) => {
				const { column, body } = await row();
				return db.gradeColumn.upsert(body, opts(column, v));
			},
			delete: async (v) => {
				const { column } = await row();
				return db.gradeColumn.delete({ id: column.id }, opts(column, v));
			},
		};
	})(),
	rollCall: (() => {
		const row = async () => {
			const { course } = await newCourse();
			const slot = await db.timeSlot.create(
				{
					course: course.id as CourseId,
					slug: `sw-${uniq()}`,
					day: "MONDAY",
					start: { hour: 8, minute: 0 },
					duration: { hours: 1 },
				},
				FULL_ACCESS,
			);
			const event = await db.calendarEvent.create(
				{
					course: course.id as CourseId,
					timeSlot: slot.id,
					week: 1,
					title: "Class",
				},
				FULL_ACCESS,
			);
			return db.rollCall.create({ event: { id: event.id } }, FULL_ACCESS);
		};
		return {
			update: async (v) => {
				const rollCall = await row();
				return db.rollCall.update(
					{ id: rollCall.id },
					{ actsAsInvite: true },
					opts(rollCall, v),
				);
			},
			delete: async (v) => {
				const rollCall = await row();
				return db.rollCall.delete({ id: rollCall.id }, opts(rollCall, v));
			},
		};
	})(),
	exam: (() => {
		const row = async () => {
			const { course } = await makeCourse();
			return { course, exam: await makeExam(course.id) };
		};
		return {
			update: async (v) => {
				const { exam } = await row();
				return db.exam.update({ id: exam.id }, { title: "x" }, opts(exam, v));
			},
			upsert: async (v) => {
				const { course, exam } = await row();
				return db.exam.upsert(
					{ course: course.id, slug: exam.slug, title: "x" },
					opts(exam, v),
				);
			},
			delete: async (v) => {
				const { exam } = await row();
				return db.exam.delete({ id: exam.id }, opts(exam, v));
			},
		};
	})(),
	examException: (() => {
		const row = async () => {
			const { course } = await makeCourse();
			const student = await enroll(course.id);
			const exam = await makeExam(course.id, { duration: { minutes: 60 } });
			const key = {
				course: course.id,
				exam: exam.slug,
				username: student.username,
			};
			const exception = await db.examException.create(
				{ ...key, extraTime: { minutes: 10 } },
				FULL_ACCESS,
			);
			return { key, exception };
		};
		return {
			update: async (v) => {
				const { key, exception } = await row();
				return db.examException.update(key, { note: "x" }, opts(exception, v));
			},
			upsert: async (v) => {
				const { key, exception } = await row();
				return db.examException.upsert(
					{ ...key, note: "x" },
					opts(exception, v),
				);
			},
			delete: async (v) => {
				const { key, exception } = await row();
				return db.examException.delete(key, opts(exception, v));
			},
		};
	})(),
	response: (() => ({
		update: async (v) => {
			const { response } = await makeResponse();
			return db.response.update(
				{ id: response.id },
				{ acceptingSubmissions: false },
				opts(response, v),
			);
		},
		upsert: async (v) => {
			const { response, course, exam, student } = await makeResponse();
			return db.response.upsert(
				{
					course: course.id,
					exam: exam.slug,
					author: student.username,
					acceptingSubmissions: false,
				},
				opts(response, v),
			);
		},
		delete: async (v) => {
			const { response } = await makeResponse();
			return db.response.delete({ id: response.id }, opts(response, v));
		},
	}))(),
	report: (() => ({
		update: async (v) => {
			const { report } = await makeReport();
			return db.report.update(
				{ publicId: report.publicId },
				{ note: "x" },
				opts(report, v),
			);
		},
		delete: async (v) => {
			const { report } = await makeReport();
			return db.report.delete({ publicId: report.publicId }, opts(report, v));
		},
	}))(),
};

/// Services with writes on a versioned model that do not honor the option
/// yet. Remove a name when its service does; the test fails if it stays.
const PENDING = new Set<string>(["feedback", "regradeRequest", "rubric"]);

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

/// The write methods of a Prisma delegate.
const WRITE_METHODS = "update|updateMany|upsert|delete|deleteMany";

/// The write operations of a nested relation write.
const NESTED_WRITES =
	"update|updateMany|upsert|delete|deleteMany|set|disconnect";

type Schema = {
	/// Table name of each versioned model (`@@map` or the model's own name).
	tables: Map<string, string>;
	/// For each relation field name, the models it points to.
	relations: Map<string, Set<string>>;
};

/// Reads the tables of the versioned models and the relation fields of `prisma/schema.prisma`.
function readSchema(versioned: Set<string>): Schema {
	const lines = readFileSync("prisma/schema.prisma", "utf8").split("\n");
	const names = new Set(
		lines.flatMap((l) => l.match(/^model (\w+) \{/)?.slice(1, 2) ?? []),
	);
	const tables = new Map<string, string>();
	const relations = new Map<string, Set<string>>();
	let current = "";
	for (const line of lines) {
		const header = line.match(/^model (\w+) \{/);
		if (header) {
			current = header[1] ?? "";
			tables.set(current, current);
			continue;
		}
		const mapped = line.match(/^\s+@@map\("(\w+)"\)/);
		if (mapped) tables.set(current, mapped[1] ?? current);
		const field = line.match(/^\s+(\w+)\s+(\w+)(?:\[\])?\??(?:\s|$)/);
		if (field && names.has(field[2] ?? "")) {
			const targets = relations.get(field[1] ?? "") ?? new Set<string>();
			targets.add(field[2] ?? "");
			relations.set(field[1] ?? "", targets);
		}
	}
	for (const model of tables.keys())
		if (!versioned.has(model)) tables.delete(model);
	return { tables, relations };
}

/// The text of the first string literal in `text`, or `""`.
function firstLiteral(text: string): string {
	const open = text.search(/[`"']/);
	if (open < 0) return "";
	const quote = text[open] ?? "";
	const close = text.indexOf(quote, open + 1);
	return close < 0 ? "" : text.slice(open + 1, close);
}

/// Every write on a versioned model in `src/db/`, wherever the file is and
/// whatever the receiver is called: Prisma calls outside the helper (`raw`)
/// and calls to the helper. A write that bypasses the helper without being a
/// plain `tx.model.update(...)` is `raw` too: raw SQL, a delegate taken out of
/// `tx` by destructuring or by index, and a nested relation write.
function scanWrites(versioned: Set<string>): WriteSite[] {
	const { tables, relations } = readSchema(versioned);
	const models = new Map([...tables].map(([model, table]) => [table, model]));
	const rawCall = new RegExp(
		`\\.([a-z]\\w*)\\s*\\.\\s*(?:${WRITE_METHODS})\\b`,
		"g",
	);
	const helperCall =
		/\b(?:guardedUpdate|guardedDelete|touch|writeCache)\(\s*\w+,\s*"(\w+)"/g;
	const indexCall = new RegExp(
		`\\b(?:tx|prisma|client)\\s*\\[\\s*["'](\\w+)["']\\s*\\]\\s*\\.\\s*(?:${WRITE_METHODS})\\b`,
		"g",
	);
	const destructured =
		/\bconst\s*\{([^}]*)\}\s*=\s*(?:tx|prisma|client|this\.client)\s*;/g;
	const nested = new RegExp(
		`\\b(\\w+)\\s*:\\s*\\{\\s*(?:${NESTED_WRITES})\\b`,
		"g",
	);
	const sql = /\$(?:executeRaw|queryRaw)(?:Unsafe)?\b/g;
	const upper = (delegate: string) =>
		delegate.charAt(0).toUpperCase() + delegate.slice(1);
	const writes: WriteSite[] = [];
	for (const { file, text } of dbSources()) {
		const add = (model: string, raw: boolean) => {
			if (versioned.has(model)) writes.push({ file, model, raw });
		};
		for (const call of text.matchAll(rawCall)) add(upper(call[1] ?? ""), true);
		for (const call of text.matchAll(indexCall))
			add(upper(call[1] ?? ""), true);
		for (const call of text.matchAll(helperCall)) {
			add(upper(call[1] ?? ""), false);
		}
		for (const taken of text.matchAll(destructured)) {
			for (const entry of (taken[1] ?? "").split(",")) {
				const [key = "", alias = key] = entry
					.split(":")
					.map((part) => part.trim());
				const writesIt = new RegExp(
					`\\b${alias}\\s*\\.\\s*(?:${WRITE_METHODS})\\b`,
				).test(text);
				if (writesIt) add(upper(key), true);
			}
		}
		for (const call of text.matchAll(nested)) {
			for (const model of relations.get(call[1] ?? "") ?? []) add(model, true);
		}
		for (const call of text.matchAll(sql)) {
			const statement = firstLiteral(
				text.slice((call.index ?? 0) + call[0].length),
			);
			const hit = statement.match(/\b(?:UPDATE|DELETE\s+FROM)\s+["'`]?(\w+)/i);
			const model = models.get(hit?.[1] ?? "");
			if (model) add(model, true);
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
