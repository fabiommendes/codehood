import { prisma } from "@/db/client";
import {
	appendBatch,
	enroll,
	historyOf,
	makeWorld,
	otherAttempt,
	send,
	storedField,
	T0,
	type World,
} from "./answer-edit-service-support";
import { expect, type Page, test } from "./fixtures";
import { parseDevalue } from "./helpers/devalue-lite";
import { logInAs } from "./stories/helpers";

// R21 and R22 over the network: session, error codes, body limits, and the
// guarantee that neither the clock nor the identity is the client's to set.

/// Some tests count every history row of the database, so the rows the dev seed
/// keeps are cleared. The rest of the seed stays: the API specs that share this
/// worker's database log in as its demo users.
test.beforeEach(async () => {
	await prisma.answerEditGap.deleteMany();
	await prisma.answerEditBatch.deleteMany();
	await prisma.answerEditField.deleteMany();
	await prisma.answerEditHistory.deleteMany();
});

/// A decoded response: loosely typed, the tests assert on what they read.
// biome-ignore lint/suspicious/noExplicitAny: test-only view of a decoded body
type Json = any;

/// The URL segments the actions address a course by.
function segments(world: World) {
	return {
		discipline: world.course.discipline.slug,
		course: `${world.course.instructor.username}_${world.course.edition.slug}`,
		exam: world.exam.slug,
	};
}

function body(world: World, extra: Record<string, unknown> = {}) {
	return { ...segments(world), attempt: world.attempt.publicId, ...extra };
}

function textItem(world: World, text = "hello") {
	return {
		question: world.slugs.text,
		field: "answer",
		batch: appendBatch("", text),
	};
}

async function call(
	page: Page,
	name: string,
	data: unknown,
): Promise<{ status: number; json: Json }> {
	const response = await page.request.post(`/_actions/${name}`, { data });
	const text = await response.text();
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		// A devalue body or a non-JSON error page.
	}
	return { status: response.status(), json: json ?? text };
}

/// Success bodies are devalue-encoded; these carry only plain JSON-like values.
async function callOk(page: Page, name: string, data: unknown) {
	const response = await page.request.post(`/_actions/${name}`, { data });
	const text = await response.text();
	expect(response.status(), text).toBe(200);
	return parseDevalue(text) as Json;
}

test("both actions refuse a call without a session", async ({ page }) => {
	const world = await makeWorld();
	const inspect = await call(page, "answerHistory.inspect", body(world));
	expect(inspect.status, JSON.stringify(inspect.json)).toBe(401);
	expect(inspect.json.code).toBe("UNAUTHORIZED");
	const send = await call(
		page,
		"answerHistory.send",
		body(world, { fields: [textItem(world)] }),
	);
	expect(send.status).toBe(401);
	expect(send.json.code).toBe("UNAUTHORIZED");
	expect(await historyOf(world)).toBeNull();
});

test("inspect and send work for the author, and inspect sees what send stored", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.student);
	const first = await callOk(page, "answerHistory.inspect", body(world));
	expect(first).toEqual({ enabled: true, fields: [] });

	const sent = await callOk(
		page,
		"answerHistory.send",
		body(world, { fields: [textItem(world)] }),
	);
	expect(sent.enabled).toBe(true);
	expect(sent.results).toHaveLength(1);
	expect(sent.results[0]).toMatchObject({
		kind: "accepted",
		question: world.slugs.text,
		field: "answer",
		receipt: { revision: 1, lastSeq: 4 },
	});

	const after = await callOk(page, "answerHistory.inspect", body(world));
	expect(after.fields).toHaveLength(1);
	expect(after.fields[0]).toMatchObject({
		question: world.slugs.text,
		text: "hello",
		revision: 1,
		nextSeq: 5,
		canWrite: true,
	});
});

test("an item that is not valid answers on its own and the others still run", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.student);
	const sent = await callOk(
		page,
		"answerHistory.send",
		body(world, {
			fields: [
				{ question: world.slugs.text, field: "answer", batch: 7 },
				textItem(world),
			],
		}),
	);
	expect(sent.results.map((r: Json) => r.kind)).toEqual([
		"conflict",
		"accepted",
	]);
	expect(sent.results[0].reason).toBe("invalid");
});

test("somebody else's attempt, a missing one and an instructor all get NOT_FOUND", async ({
	page,
}) => {
	const world = await makeWorld();
	const other = await otherAttempt(world);
	await logInAs(page, world.student);
	const results = [];
	for (const name of ["answerHistory.inspect", "answerHistory.send"]) {
		const extra = name.endsWith("send") ? { fields: [textItem(world)] } : {};
		results.push(
			await call(page, name, {
				...body(world, extra),
				attempt: other.attempt.publicId,
			}),
			await call(page, name, { ...body(world, extra), attempt: "nope" }),
		);
	}
	for (const r of results) {
		expect(r.status).toBe(404);
		expect(r.json.code).toBe("NOT_FOUND");
	}
	// The same body for every case: nothing tells a foreign attempt from a missing one.
	expect(new Set(results.map((r) => JSON.stringify(r.json))).size).toBe(1);
	expect(await prisma.answerEditHistory.count()).toBe(0);
});

test("the instructor and a stranger cannot read or write the student's history", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.instructor);
	for (const [name, extra] of [
		["answerHistory.inspect", {}],
		["answerHistory.send", { fields: [textItem(world)] }],
	] as const) {
		const r = await call(page, name, body(world, extra));
		expect(r.status).toBe(404);
		expect(r.json.code).toBe("NOT_FOUND");
	}
	const stranger = await enroll(world.course.id);
	await logInAs(page, stranger);
	const r = await call(page, "answerHistory.inspect", body(world));
	expect(r.status).toBe(404);
	expect(await historyOf(world)).toBeNull();
});

test("128 items are processed and 129 are a bad request (400)", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.student);
	const item = { question: world.slugs.outside, field: "answer" };
	const ok = await callOk(
		page,
		"answerHistory.send",
		body(world, { fields: Array.from({ length: 128 }, () => item) }),
	);
	expect(ok.results).toHaveLength(128);
	const over = await call(
		page,
		"answerHistory.send",
		body(world, { fields: Array.from({ length: 129 }, () => item) }),
	);
	expect(over.status).toBe(400);
	expect(over.json.type).toBe("AstroActionInputError");
});

test("a body that is not an envelope is a bad request (400)", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.student);
	for (const data of [
		body(world, { fields: "nope" }),
		body(world, {}),
		{ ...body(world, { fields: [] }), attempt: 5 },
	]) {
		const r = await call(page, "answerHistory.send", data);
		expect(r.status).toBe(400);
		expect(r.json.type).toBe("AstroActionInputError");
	}
	const r = await call(page, "answerHistory.inspect", {
		...body(world),
		attempt: undefined,
	});
	expect(r.status).toBe(400);
});

test("a body above the action size limit is refused with a client error, not a 500", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.student);
	const huge = "x".repeat(9 * 1024 * 1024);
	const r = await call(
		page,
		"answerHistory.send",
		body(world, {
			fields: [{ question: world.slugs.text, field: "answer", pad: huge }],
		}),
	);
	expect(r.status).toBeGreaterThanOrEqual(400);
	expect(r.status).toBeLessThan(500);
	expect(await historyOf(world)).toBeNull();
});

test("a batch that is too big for one call leaves the rest as retry", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.student);
	// 40 items of ~60 KiB of junk each go past the 2 MiB per-call budget.
	const junk = "y".repeat(60 * 1024);
	const fields = Array.from({ length: 40 }, () => ({
		question: world.slugs.outside,
		field: "answer",
		pad: junk,
	}));
	const sent = await callOk(
		page,
		"answerHistory.send",
		body(world, { fields }),
	);
	const kinds = sent.results.map((r: Json) => r.kind);
	expect(kinds).toContain("retry");
	expect(kinds).toHaveLength(40);
});

test.describe("the client cannot set the clock or the identity", () => {
	test("`now` in the body does not reopen a closed window", async ({
		page,
	}) => {
		// The attempt started at T0 and lasted an hour: long over today.
		const world = await makeWorld({ startAtT0: true });
		await logInAs(page, world.student);
		const forged = new Date(T0.getTime() + 10 * 60_000);
		for (const now of [forged.toISOString(), forged.getTime()]) {
			const sent = await callOk(
				page,
				"answerHistory.send",
				body(world, { now, fields: [textItem(world)] }),
			);
			expect(sent.results[0]).toMatchObject({
				kind: "closed",
				reason: "deadline",
			});
		}
		const inspected = await callOk(
			page,
			"answerHistory.inspect",
			body(world, { now: forged.toISOString() }),
		);
		expect(inspected.fields).toEqual([]);
		expect(await historyOf(world)).toBeNull();
		// Also nested in the item, where a sloppy spread could pick it up.
		const nested = await callOk(
			page,
			"answerHistory.send",
			body(world, {
				fields: [{ ...textItem(world), now: forged.toISOString() }],
			}),
		);
		expect(nested.results[0]).toMatchObject({
			kind: "closed",
			reason: "deadline",
		});
		expect(await historyOf(world)).toBeNull();
	});

	test("`now` in the inspect body does not make a closed attempt writable", async ({
		page,
	}) => {
		const world = await makeWorld({ startAtT0: true });
		// Stored while the window was open, through the service and its injected clock.
		const inside = new Date(T0.getTime() + 10 * 60_000);
		await send(world, [textItem(world)], inside);
		await logInAs(page, world.student);
		const honest = await callOk(page, "answerHistory.inspect", body(world));
		expect(honest.fields[0]).toMatchObject({ canWrite: false });
		for (const now of [inside.toISOString(), inside.getTime()]) {
			const forged = await callOk(
				page,
				"answerHistory.inspect",
				body(world, { now }),
			);
			expect(forged.fields[0]).toMatchObject({ canWrite: false });
		}
	});

	test("author and attempt metadata in the body change nothing", async ({
		page,
	}) => {
		const world = await makeWorld();
		const other = await otherAttempt(world);
		await logInAs(page, world.student);
		const sent = await callOk(
			page,
			"answerHistory.send",
			body(world, {
				author: other.student.username,
				authorId: other.student.username,
				responseId: other.attempt.id,
				actor: other.student.username,
				fields: [textItem(world)],
			}),
		);
		expect(sent.results[0].kind).toBe("accepted");
		expect(await historyOf(world)).not.toBeNull();
		const foreign = await prisma.answerEditHistory.findUnique({
			where: { responseId: other.attempt.id },
		});
		expect(foreign).toBeNull();
	});
});

test("a switch turned off answers enabled false and stores nothing", async ({
	page,
}) => {
	const world = await makeWorld();
	await prisma.exam.update({
		where: { id: world.exam.id },
		data: { answerHistory: false },
	});
	await logInAs(page, world.student);
	const sent = await callOk(
		page,
		"answerHistory.send",
		body(world, { fields: [textItem(world)] }),
	);
	expect(sent.enabled).toBe(false);
	expect(sent.results[0]).toMatchObject({ kind: "closed", reason: "disabled" });
	expect(await storedField(world)).toBeNull();
	const inspected = await callOk(page, "answerHistory.inspect", body(world));
	expect(inspected.enabled).toBe(false);
});

//
// R22: the switch in the response of exam.answer
//

async function answer(page: Page, world: World, payload = "an answer") {
	return call(page, "exam.answer", {
		...segments(world),
		question: world.slugs.text,
		payload,
	});
}

test.describe("exam.answer reports the effective switch", () => {
	const cases = [
		["EXAM", null, true],
		["QUIZ", null, true],
		["PRACTICE", null, false],
		["PRACTICE", true, true],
		["EXAM", false, false],
	] as const;
	for (const [type, stored, expected] of cases) {
		test(`${type} with ${stored} answers ${expected}`, async ({ page }) => {
			const world = await makeWorld({ type });
			await prisma.exam.update({
				where: { id: world.exam.id },
				data: { answerHistory: stored },
			});
			await logInAs(page, world.student);
			const response = await page.request.post("/_actions/exam.answer", {
				data: {
					...segments(world),
					question: world.slugs.text,
					payload: "an answer",
				},
			});
			expect(response.status()).toBe(200);
			const result = parseDevalue(await response.text()) as Json;
			expect(result.answerHistory).toBe(expected);
			expect(typeof result.serverNow).toBe("number");
		});
	}
});

test("exam.answer keeps saving while the history cannot write", async ({
	page,
}) => {
	const world = await makeWorld();
	await logInAs(page, world.student);
	await prisma.$executeRawUnsafe(
		`CREATE TRIGGER history_boom BEFORE INSERT ON "AnswerEditBatch" BEGIN SELECT RAISE(ABORT, 'boom'); END`,
	);
	try {
		// Whatever the history answers while it fails, it is not the answer path.
		const failing = await call(
			page,
			"answerHistory.send",
			body(world, { fields: [textItem(world)] }),
		);
		expect(failing.status).not.toBe(401);
		const saved = await answer(page, world, "still saved");
		expect(saved.status).toBe(200);
		const rows = await prisma.submission.findMany({
			where: { responseId: world.attempt.id },
		});
		expect(rows.map((r) => r.payload)).toEqual(["still saved"]);
		expect(await prisma.answerEditBatch.count()).toBe(0);
	} finally {
		await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS history_boom`);
	}
});
