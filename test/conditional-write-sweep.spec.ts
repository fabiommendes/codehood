import { readFileSync } from "node:fs";
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

/// Services that honor the option. Each entry creates a row and runs every
/// write of the service with a stale version; all of them must reject with
/// `PreconditionFailed`.
const HONORED: Record<
	string,
	Partial<Record<Write, () => Promise<unknown>>>
> = {
	discipline: (() => {
		const row = async () => {
			const slug = `sw-d-${uniq()}`;
			await db.discipline.create({ slug, name: slug }, FULL_ACCESS);
			return slug;
		};
		const stale = { ...FULL_ACCESS, expectedUpdatedAt: STALE };
		return {
			update: async () =>
				db.discipline.update({ slug: await row() }, { name: "x" }, stale),
			upsert: async () =>
				db.discipline.upsert({ slug: await row(), name: "x" }, stale),
			delete: async () => db.discipline.delete({ slug: await row() }, stale),
		};
	})(),
	course: (() => {
		const row = async () => {
			const course = (await db.course.findMany({}, FULL_ACCESS))[0];
			if (!course) throw new Error("the seed has no course");
			return course;
		};
		const stale = { ...FULL_ACCESS, expectedUpdatedAt: STALE };
		const pk = (c: Awaited<ReturnType<typeof row>>) => ({
			discipline: c.discipline.slug,
			instructor: c.instructor.username,
			edition: c.edition.slug,
		});
		return {
			update: async () => {
				const c = await row();
				return db.course.update(pk(c), { description: "x" }, stale);
			},
			upsert: async () => {
				const c = await row();
				return db.course.upsert(
					{ ...pk(c), startAt: c.startAt, endAt: c.endAt },
					stale,
				);
			},
			delete: async () => {
				const c = await row();
				return db.course.delete(pk(c), stale);
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

const kebab = (key: string) =>
	key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const sourceOf = (key: string) =>
	readFileSync(`src/db/services/${kebab(key)}.service.ts`, "utf8");

/// The versioned models the service source writes with update, upsert or delete.
function writtenVersionedModels(key: string, versioned: Set<string>): string[] {
	const found = new Set<string>();
	for (const call of sourceOf(key).matchAll(
		/\btx\.(\w+)\.(?:update|upsert|delete|updateMany|deleteMany)\b/g,
	)) {
		const delegate = call[1] ?? "";
		const model = delegate.charAt(0).toUpperCase() + delegate.slice(1);
		if (versioned.has(model)) found.add(model);
	}
	return [...found];
}

const writeOps = (key: string): Write[] =>
	WRITES.filter(
		(op) =>
			typeof (db as Record<string, Record<string, unknown>>)[key]?.[op] ===
			"function",
	);

const honorsOption = (key: string) => /conditional-write/.test(sourceOf(key));

const keys = Object.keys(db);

test("every service that writes a versioned model honors expectedUpdatedAt", () => {
	const versioned = versionedModels();
	const unaccounted: string[] = [];
	for (const key of keys) {
		if (key in EXEMPT || writeOps(key).length === 0) continue;
		if (writtenVersionedModels(key, versioned).length === 0) continue;
		if (key in HONORED || PENDING.has(key)) continue;
		unaccounted.push(key);
	}
	expect(
		unaccounted,
		"add a HONORED entry (or PENDING, temporarily) for these services",
	).toEqual([]);
});

test("PENDING lists only services that still need the option", () => {
	const versioned = versionedModels();
	const rotten = [...PENDING].filter(
		(key) =>
			!keys.includes(key) ||
			honorsOption(key) ||
			writeOps(key).length === 0 ||
			writtenVersionedModels(key, versioned).length === 0,
	);
	expect(rotten, "remove these from PENDING").toEqual([]);
});

for (const [key, ops] of Object.entries(HONORED)) {
	test(`${key}: every write rejects a stale expectedUpdatedAt`, async () => {
		expect(honorsOption(key), "the service source never uses the helper").toBe(
			true,
		);
		expect(Object.keys(ops).sort(), "HONORED must cover each write").toEqual(
			writeOps(key).sort(),
		);
		for (const [op, run] of Object.entries(ops)) {
			const error = await run().catch((e: unknown) => e);
			expect(error, `${key}.${op}`).toBeInstanceOf(PreconditionFailed);
		}
	});
}
