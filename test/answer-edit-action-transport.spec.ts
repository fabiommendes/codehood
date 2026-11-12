import { expect, test } from "@playwright/test";
import * as session from "@/components/exam/answer-edit-session";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";

// R25 (spec `historico-de-edicao-no-servidor`): the real transport over the
// actions, with the actions injected.
//
// Assumed signature, the spec gives none for the factory. It is exported from
// `src/components/exam/answer-edit-session.ts` and takes what the page already
// has, so the module needs no `astro:actions` import of its own:
//
//   createActionTransport({
//     actions: { inspect(input), send(input) },   // `actions.answerHistory`
//     exam: { discipline, course, exam },         // the URL segments
//     onDisabled: () => void,                     // the page ties it to `disable()`
//   }): AttemptTransport
//
// `attemptId` of the coordinator is the attempt's `publicId` (R27), so the
// transport sends it as `attempt`. An action returns Astro's
// `{ data, error }` pair, or rejects when the network fails.

/// Read off the namespace so a missing export fails each test, not the whole file.
const createActionTransport = session.createActionTransport;

const EXAM = { discipline: "cs101", course: "ada_2026-2", exam: "midterm" };
const ATTEMPT = "attempt-public-id";
const REF = { attemptId: ATTEMPT, questionId: "essay-1", field: "answer" };
const OTHER = { ...REF, questionId: "essay-2" };

/// What an Astro action resolves to: data, or an error with a code.
type Outcome =
	| { data: unknown; error?: undefined }
	| { data?: undefined; error: { code: string; message: string } };
type Input = Record<string, unknown>;

/// An action that replays `outcomes` in order (the last one repeats) and records its inputs.
function fakeAction(...outcomes: (Outcome | "network")[]) {
	const inputs: Input[] = [];
	const action = async (input: Input): Promise<Outcome> => {
		inputs.push(structuredClone(input));
		const outcome = outcomes[Math.min(inputs.length, outcomes.length) - 1];
		if (outcome === "network") throw new TypeError("Failed to fetch");
		return outcome ?? { data: undefined };
	};
	return { action, inputs };
}

function failure(code: string): Outcome {
	return { error: { code, message: code } };
}

function make(options: { inspect?: Outcome[]; send?: Outcome[] } = {}) {
	const inspect = fakeAction(...(options.inspect ?? [inspected([])]));
	const send = fakeAction(...(options.send ?? [sent([])]));
	let disabled = 0;
	const transport = createActionTransport({
		actions: { inspect: inspect.action, send: send.action },
		exam: EXAM,
		onDisabled: () => {
			disabled++;
		},
	});
	return {
		transport,
		inspections: inspect.inputs,
		sends: send.inputs,
		disabledCalls: () => disabled,
	};
}

function inspected(fields: unknown[], enabled = true): Outcome {
	return { data: { enabled, fields } };
}

function sent(results: unknown[], enabled = true): Outcome {
	return { data: { enabled, results } };
}

/// A real first batch of a field that starts empty, as the monitor collects it.
function firstBatch(text: string) {
	const monitor = new AnswerEditMonitor({
		initialText: "",
		sessionId: "s1",
		baseRevision: 0,
		firstSeq: 1,
		now: () => 0,
	});
	monitor.recordChange({
		atMs: 10,
		kind: "typing",
		replacements: [{ position: 0, deleteCount: 0, insertedText: text }],
	});
	const batch = monitor.collect();
	if (!batch) throw new Error("Expected a batch");
	return batch;
}

test.describe("send", () => {
	test("posts the exam segments, the attempt and each item with the question as `question`", async () => {
		const batch = firstBatch("hello");
		const { transport, sends } = make({
			send: [
				sent([
					{
						question: "essay-1",
						field: "answer",
						kind: "accepted",
						receipt: { batchId: batch.batchId, revision: 1, lastSeq: 5 },
					},
				]),
			],
		});

		await transport.send({
			attemptId: ATTEMPT,
			fields: [{ questionId: "essay-1", field: "answer", batch }],
		});

		expect(sends).toEqual([
			{
				...EXAM,
				attempt: ATTEMPT,
				fields: [{ question: "essay-1", field: "answer", batch }],
			},
		]);
	});

	test("a batch keeps the base the monitor attached to it", async () => {
		const batch = firstBatch("hello");
		expect(batch.base).toEqual({ reason: "start", text: "" });
		const { transport, sends } = make();

		await transport.send({
			attemptId: ATTEMPT,
			fields: [{ questionId: "essay-1", field: "answer", batch }],
		});

		const [item] = (sends[0]?.fields ?? []) as { batch: unknown }[];
		expect(item?.batch).toEqual(batch);
	});

	test("gaps travel in the item of their field, with or without a batch", async () => {
		const batch = firstBatch("hello");
		const { transport, sends } = make();

		await transport.send({
			attemptId: ATTEMPT,
			fields: [
				{
					questionId: "essay-1",
					field: "answer",
					batch,
					gaps: [{ reason: "quota exceeded" }],
				},
				{
					questionId: "essay-2",
					field: "answer",
					gaps: [{ reason: "disabled" }, { reason: "again" }],
				},
			],
		} as never);

		expect(sends[0]?.fields).toEqual([
			{
				question: "essay-1",
				field: "answer",
				batch,
				gaps: [{ reason: "quota exceeded" }],
			},
			{
				question: "essay-2",
				field: "answer",
				gaps: [{ reason: "disabled" }, { reason: "again" }],
			},
		]);
	});

	test("each per-item result reaches the coordinator under the field of the item", async () => {
		const receipt = { batchId: "s1:1", revision: 1, lastSeq: 5 };
		const { transport } = make({
			send: [
				sent([
					{ question: "essay-1", field: "answer", kind: "accepted", receipt },
					{
						question: "essay-2",
						field: "answer",
						kind: "conflict",
						reason: "base",
					},
					{
						question: "essay-3",
						field: "answer",
						kind: "closed",
						reason: "deadline",
					},
					{ question: "essay-4", field: "answer", kind: "retry" },
				]),
			],
		});
		const batch = firstBatch("x");

		const results = await transport.send({
			attemptId: ATTEMPT,
			fields: ["essay-1", "essay-2", "essay-3", "essay-4"].map((id) => ({
				questionId: id,
				field: "answer",
				batch,
			})),
		});

		expect(results).toMatchObject([
			{ questionId: "essay-1", field: "answer", kind: "accepted", receipt },
			{ questionId: "essay-2", field: "answer", kind: "conflict" },
			{ questionId: "essay-3", field: "answer", kind: "closed" },
			{ questionId: "essay-4", field: "answer", kind: "retry" },
		]);
	});

	test("an accepted gap-only item has no receipt to carry", async () => {
		const { transport } = make({
			send: [
				sent([{ question: "essay-1", field: "answer", kind: "accepted" }]),
			],
		});

		const results = await transport.send({
			attemptId: ATTEMPT,
			fields: [
				{ questionId: "essay-1", field: "answer", gaps: [{ reason: "x" }] },
			],
		} as never);

		expect(results).toMatchObject([
			{ questionId: "essay-1", field: "answer", kind: "accepted" },
		]);
	});
});

test.describe("inspect", () => {
	test("posts the segments and the attempt, and translates the field of the reference", async () => {
		const receipts = [{ batchId: "s1:1", revision: 2, lastSeq: 6 }];
		const { transport, inspections } = make({
			inspect: [
				inspected([
					{
						question: "essay-1",
						field: "answer",
						text: "abc",
						revision: 2,
						nextSeq: 7,
						canWrite: true,
						receipts,
					},
				]),
			],
		});

		const state = await transport.inspect(REF);

		expect(inspections).toEqual([{ ...EXAM, attempt: ATTEMPT }]);
		expect(state).toEqual({
			text: "abc",
			revision: 2,
			nextSeq: 7,
			canWrite: true,
			receipts,
		});
	});

	test("a field the server has no anchor for starts from revision 0, sequence 0 and empty text", async () => {
		const { transport } = make({ inspect: [inspected([])] });

		const state = await transport.inspect(REF);

		expect(state).toMatchObject({
			text: "",
			revision: 0,
			nextSeq: 0,
			receipts: [],
		});
	});

	test("the fields asked in the same turn share one request, and each gets its own state", async () => {
		const { transport, inspections } = make({
			inspect: [
				inspected([
					{
						question: "essay-2",
						field: "answer",
						text: "second",
						revision: 1,
						nextSeq: 3,
						canWrite: true,
						receipts: [],
					},
				]),
			],
		});

		const [first, second] = await Promise.all([
			transport.inspect(REF),
			transport.inspect(OTHER),
		]);

		expect(inspections).toHaveLength(1);
		expect(first).toMatchObject({ text: "", revision: 0 });
		expect(second).toMatchObject({ text: "second", revision: 1, nextSeq: 3 });
	});

	test("a later turn asks again, so a rebase never reads a stale state", async () => {
		const { transport, inspections } = make({
			inspect: [
				inspected([]),
				inspected([
					{
						question: "essay-1",
						field: "answer",
						text: "newer",
						revision: 4,
						nextSeq: 9,
						canWrite: true,
						receipts: [],
					},
				]),
			],
		});

		await transport.inspect(REF);
		const again = await transport.inspect(REF);

		expect(inspections).toHaveLength(2);
		expect(again).toMatchObject({ text: "newer", revision: 4 });
	});
});

const ENDPOINTS = ["inspect", "send"] as const;

for (const endpoint of ENDPOINTS) {
	/// One call of `endpoint` on a transport whose action answers `outcome`.
	function call(outcome: Outcome | "network", followUp?: Outcome) {
		const outcomes = followUp ? [outcome, followUp] : [outcome];
		const fake = fakeAction(...outcomes);
		const other = fakeAction(inspected([]));
		const actions =
			endpoint === "inspect"
				? { inspect: fake.action, send: other.action }
				: { inspect: other.action, send: fake.action };
		const transport = createActionTransport({
			actions,
			exam: EXAM,
			onDisabled: () => {},
		});
		const run = () =>
			endpoint === "inspect"
				? transport.inspect(REF)
				: transport.send({
						attemptId: ATTEMPT,
						fields: [
							{
								questionId: "essay-1",
								field: "answer",
								batch: firstBatch("x"),
							},
						],
					});
		return { run, inputs: fake.inputs };
	}

	test.describe(`${endpoint}: errors`, () => {
		const keepsTrying: [string, Outcome | "network"][] = [
			["a network failure", "network"],
			["a server error", failure("INTERNAL_SERVER_ERROR")],
			["a request without a session", failure("UNAUTHORIZED")],
		];
		for (const [label, outcome] of keepsTrying) {
			test(`${label} rejects and the next call still reaches the server`, async () => {
				const ok = endpoint === "inspect" ? inspected([]) : sent([]);
				const { run, inputs } = call(outcome, ok);

				await expect(run()).rejects.toBeDefined();
				await run().catch(() => {});

				expect(inputs).toHaveLength(2);
			});
		}

		const stops: [string, Outcome][] = [
			["NOT_FOUND", failure("NOT_FOUND")],
			["BAD_REQUEST", failure("BAD_REQUEST")],
		];
		for (const [label, outcome] of stops) {
			test(`${label} rejects, and the page stops asking: the same request would get the same error`, async () => {
				const ok = endpoint === "inspect" ? inspected([]) : sent([]);
				const { run, inputs } = call(outcome, ok);

				await expect(run()).rejects.toBeDefined();
				await expect(run()).rejects.toBeDefined();

				expect(inputs).toHaveLength(1);
			});
		}

		const malformed: [string, Outcome][] = [
			["no data and no error", { data: undefined }],
			["null data", { data: null }],
			["data that is not an object", { data: "ok" }],
			["data without the list", { data: { enabled: true } }],
			[
				"a list that is not a list",
				{
					data: {
						enabled: true,
						...(endpoint === "inspect"
							? { fields: "nope" }
							: { results: "nope" }),
					},
				},
			],
		];
		for (const [label, outcome] of malformed) {
			test(`a response with ${label} rejects instead of pretending the server accepted`, async () => {
				const { run } = call(outcome);

				await expect(run()).rejects.toBeDefined();
			});
		}
	});
}

test.describe("the switch turned off on the server", () => {
	test("an inspect answer with enabled false calls onDisabled", async () => {
		const { transport, disabledCalls } = make({
			inspect: [inspected([], false)],
		});

		await transport.inspect(REF).catch(() => {});

		expect(disabledCalls()).toBe(1);
	});

	test("a send answer with enabled false calls onDisabled and hands the closed results on", async () => {
		const { transport, disabledCalls } = make({
			send: [
				sent(
					[
						{
							question: "essay-1",
							field: "answer",
							kind: "closed",
							reason: "disabled",
						},
					],
					false,
				),
			],
		});

		const results = await transport.send({
			attemptId: ATTEMPT,
			fields: [
				{ questionId: "essay-1", field: "answer", batch: firstBatch("x") },
			],
		});

		expect(disabledCalls()).toBe(1);
		expect(results).toMatchObject([{ questionId: "essay-1", kind: "closed" }]);
	});

	test("enabled true never calls onDisabled", async () => {
		const { transport, disabledCalls } = make();

		await transport.inspect(REF);
		await transport.send({
			attemptId: ATTEMPT,
			fields: [
				{ questionId: "essay-1", field: "answer", batch: firstBatch("x") },
			],
		});

		expect(disabledCalls()).toBe(0);
	});

	test("an onDisabled that throws does not make the transport fail", async () => {
		const send = fakeAction(
			sent(
				[
					{
						question: "essay-1",
						field: "answer",
						kind: "closed",
						reason: "disabled",
					},
				],
				false,
			),
		);
		const transport = createActionTransport({
			actions: { inspect: fakeAction(inspected([])).action, send: send.action },
			exam: EXAM,
			onDisabled: () => {
				throw new Error("page callback failed");
			},
		});

		await expect(
			transport.send({
				attemptId: ATTEMPT,
				fields: [
					{ questionId: "essay-1", field: "answer", batch: firstBatch("x") },
				],
			}),
		).resolves.toMatchObject([{ kind: "closed" }]);
	});
});
