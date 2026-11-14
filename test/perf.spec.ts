import { expect, test } from "@playwright/test";
import type { APIContext } from "astro";
import { SYSTEM } from "@/auth/actor";
import { NotAllowed } from "@/core/error";
import type { CourseId } from "@/core/schemas/base";
import { db } from "@/db";
import type { ServiceOptsWithoutTx as Opts } from "@/db/base-service";
import type { PrismaClient, PrismaTx } from "@/db/client";
import { prisma } from "@/db/client";
import { defineService, nameServices, op } from "@/db/define-service";
import { PERF } from "@/perf/config";
import { measureRequest } from "@/perf/request";
import { beginServiceCall, endServiceCall } from "@/perf/service";
import { noteRpcMethod, runAsRequest, totals } from "@/perf/state";

type Line = Record<string, unknown>;

/// Runs `fn` with the performance log on and returns the lines it wrote.
async function logged(fn: () => Promise<unknown>): Promise<Line[]> {
	const original = process.stdout.write;
	const settings = { ...PERF };
	const lines: Line[] = [];
	process.stdout.write = ((chunk: string | Uint8Array) => {
		for (const text of chunk.toString().split("\n"))
			if (text.startsWith("{")) lines.push(JSON.parse(text));
		return true;
	}) as typeof process.stdout.write;
	PERF.enabled = true;
	try {
		await fn();
		// A service call is closed in a reaction to its promise.
		await new Promise((resolve) => setTimeout(resolve, 0));
	} finally {
		process.stdout.write = original;
		Object.assign(PERF, settings);
	}
	return lines;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/// A service with a fast and a slow operation, on a client that needs no database.
function fakeService() {
	const client = {
		$transaction: (fn: (tx: PrismaTx) => Promise<unknown>) =>
			fn({} as PrismaTx),
	} as unknown as PrismaClient;
	const make = defineService()(() => ({
		fast: op({ run: async (_tx: PrismaTx, _opts: Opts) => "fast" }),
		slow: op({
			run: async (_tx: PrismaTx, _opts: Opts) => {
				await sleep(30);
				return "slow";
			},
		}),
		fails: op({
			run: async (_tx: PrismaTx, _opts: Opts): Promise<string> => {
				await sleep(30);
				throw new Error("boom");
			},
		}),
	}));
	return make(client);
}

/// The part of an Astro context `measureRequest` reads.
function fakeContext(
	init: {
		method?: string;
		path?: string;
		pattern?: string;
		headers?: Record<string, string>;
		locals?: App.Locals;
	} = {},
): APIContext {
	const path = init.path ?? "/c/secret-slug";
	return {
		url: new URL(`http://localhost${path}?token=never-logged`),
		routePattern: init.pattern ?? "/c/[course]",
		request: new Request(`http://localhost${path}`, {
			method: init.method ?? "GET",
			headers: init.headers,
		}),
		locals: init.locals ?? {},
	} as unknown as APIContext;
}

test.describe
	.serial("performance log", () => {
		test("a service call at or above the threshold logs one line, a faster one logs nothing", async () => {
			const service = fakeService();
			nameServices({ thing: service });

			const lines = await logged(async () => {
				PERF.slowServiceMs = 20;
				expect(await service.fast({ actor: SYSTEM })).toBe("fast");
				expect(await service.slow({ actor: SYSTEM })).toBe("slow");
			});

			expect(lines).toHaveLength(1);
			expect(lines[0]).toMatchObject({
				event: "slow-service",
				op: "thing.slow",
				nested: false,
				actor: "system",
			});
			expect(lines[0]?.ms).toBeGreaterThanOrEqual(20);
		});

		test("a slow service call names the request it ran under and whether it was nested", async () => {
			const service = fakeService();
			nameServices({ thing: service });

			const lines = await logged(() =>
				runAsRequest("req-1", "POST /api/things", async () => {
					PERF.slowServiceMs = 20;
					await service.slow({ actor: SYSTEM, tx: {} as PrismaTx });
				}),
			);

			expect(lines).toEqual([
				expect.objectContaining({
					event: "slow-service",
					op: "thing.slow",
					nested: true,
					id: "req-1",
					route: "POST /api/things",
				}),
			]);
		});

		test("a service call that rejects is still timed and still rejects", async () => {
			const service = fakeService();
			nameServices({ thing: service });

			const lines = await logged(async () => {
				PERF.slowServiceMs = 20;
				await expect(service.fails({ actor: SYSTEM })).rejects.toThrow("boom");
			});

			expect(lines).toMatchObject([
				{ event: "slow-service", op: "thing.fails" },
			]);
		});

		test("a service outside every registry reports as `service`", async () => {
			const service = fakeService();
			const lines = await logged(async () => {
				PERF.slowServiceMs = 20;
				await service.slow({ actor: SYSTEM });
			});
			expect(lines).toMatchObject([{ op: "service.slow" }]);
		});

		test("with the log off a service call is not timed", async () => {
			const settings = { ...PERF };
			PERF.enabled = false;
			try {
				expect(beginServiceCall("thing.slow", false, SYSTEM)).toBeNull();
			} finally {
				Object.assign(PERF, settings);
			}
		});

		test("the services of `db` report under their registry name", async () => {
			const lines = await logged(async () => {
				PERF.slowServiceMs = 0;
				await db.gradingJob.totals({ actor: SYSTEM });
			});
			expect(lines).toMatchObject([
				{ event: "slow-service", op: "gradingJob.totals" },
			]);
		});

		test("statements count towards the request, raw SQL and COMMIT included", async () => {
			const before = totals.commits.count;
			let seen = { queries: 0, dbMs: 0 };

			await logged(() =>
				runAsRequest("req-2", "GET /x", async (perf) => {
					await prisma.$queryRaw`SELECT 1`;
					const afterRaw = perf.queries;
					await prisma.$transaction((tx) => tx.user.count());
					seen = { queries: perf.queries, dbMs: perf.dbMs };
					expect(afterRaw).toBe(1);
				}),
			);

			// `SELECT 1`, the count and the COMMIT of its transaction.
			expect(seen.queries).toBeGreaterThanOrEqual(3);
			expect(seen.dbMs).toBeGreaterThan(0);
			expect(totals.commits.count).toBeGreaterThan(before);
		});

		test("a statement at or above the threshold logs its SQL without the parameters", async () => {
			const lines = await logged(() =>
				runAsRequest("req-3", "GET /x", async () => {
					PERF.slowQueryMs = 0;
					await prisma.$queryRaw`SELECT ${"a-secret-value"} AS v`;
				}),
			);

			const slow = lines.filter((line) => line.event === "slow-query");
			expect(slow).toMatchObject([
				{ sql: "SELECT ? AS v", id: "req-3", route: "GET /x" },
			]);
			expect(JSON.stringify(lines)).not.toContain("a-secret-value");
		});

		for (const transaction of [true, false])
			test(`statements of service calls in parallel name their own call, ${transaction ? "in" : "without"} a transaction`, async () => {
				const make = defineService()(() => ({
					users: op({
						transaction,
						run: async (tx: PrismaTx, _opts: Opts) => {
							await tx.user.findUnique({ where: { username: "-" } });
							await sleep(5);
							return tx.user.count();
						},
					}),
					courses: op({
						transaction,
						run: async (tx: PrismaTx, _opts: Opts) => {
							await tx.course.findUnique({ where: { id: -1 as CourseId } });
							await sleep(10);
							return tx.course.count();
						},
					}),
				}));
				const service = make();
				nameServices({ parallel: service });

				const lines = await logged(() =>
					runAsRequest("req-4", "GET /x", async () => {
						PERF.slowQueryMs = 0;
						await Promise.all([
							service.users({ actor: SYSTEM }),
							service.courses({ actor: SYSTEM }),
							service.users({ actor: SYSTEM }),
						]);
						await prisma.$queryRaw`SELECT 1`;
					}),
				);

				// Outside a transaction Prisma runs the `findUnique` of one tick as a
				// batch, under the call that asked first.
				const batched = (sql: string) => !transaction && sql.includes(" = ?");
				const ops = (table: string) =>
					lines
						.filter((line) => String(line.sql).includes(`\`${table}\``))
						.filter((line) => !batched(String(line.sql)))
						.map((line) => line.op);
				expect(ops("User").length).toBeGreaterThanOrEqual(2);
				expect(new Set(ops("User"))).toEqual(new Set(["parallel.users"]));
				expect(ops("Course").length).toBeGreaterThanOrEqual(1);
				expect(new Set(ops("Course"))).toEqual(new Set(["parallel.courses"]));
				expect(lines.find((line) => line.sql === "SELECT 1")?.op).toBeNull();
			});

		test("a request logs one line with its route pattern, status, timings and credential", async () => {
			let response: Response | undefined;
			const lines = await logged(async () => {
				PERF.slowServiceMs = 1000;
				response = await measureRequest(
					fakeContext({
						headers: {
							cookie: "session=cookie-secret",
							authorization: "Bearer key-secret",
						},
						locals: {
							actor: { role: "STUDENT", name: "Ana", username: "ana" },
						} as App.Locals,
					}),
					async () => {
						await db.gradingJob.totals({ actor: SYSTEM });
						return new Response("ok", { status: 201 });
					},
				);
			});

			expect(lines).toHaveLength(1);
			const [line] = lines;
			expect(line).toMatchObject({
				event: "request",
				route: "GET /c/[course]",
				status: 201,
				services: 1,
				slowest: "gradingJob.totals",
				auth: "session",
				user: "ana",
			});
			expect(line?.queries).toBeGreaterThanOrEqual(3);
			expect(line?.ms).toBeGreaterThanOrEqual(line?.db as number);
			expect(response?.headers.get("x-request-id")).toBe(line?.id);

			const text = JSON.stringify(line);
			for (const secret of [
				"secret-slug",
				"never-logged",
				"cookie-secret",
				"key-secret",
			])
				expect(text).not.toContain(secret);
		});

		test("a request keeps the id its proxy sent and names its API key kind", async () => {
			const lines = await logged(() =>
				measureRequest(
					fakeContext({
						headers: { "x-request-id": "caddy-42" },
						locals: {
							actor: { role: "INSTRUCTOR", name: "Bia", username: "bia" },
							apiKey: { id: 1, kind: "BOT" },
						} as App.Locals,
					}),
					async () => new Response(null, { status: 204 }),
				),
			);
			expect(lines).toMatchObject([
				{ id: "caddy-42", auth: "bot", user: "bia" },
			]);
		});

		test("an action is named and an RPC call carries its method", async () => {
			const lines = await logged(async () => {
				await measureRequest(
					fakeContext({
						method: "POST",
						path: "/_actions/exam.save",
						pattern: "/_actions/[...path]",
					}),
					async () => new Response("ok"),
				);
				await measureRequest(
					fakeContext({ method: "POST", path: "/rpc", pattern: "/rpc" }),
					async () => {
						noteRpcMethod("course.list");
						noteRpcMethod("exam.list");
						return new Response("ok");
					},
				);
			});

			expect(lines).toMatchObject([
				{ route: "POST /_actions/exam.save", auth: "anon", user: null },
				{ route: "POST /rpc", rpc: "course.list", rpcCalls: 2 },
			]);
		});

		test("a request that throws logs a 500 and rethrows", async () => {
			const lines = await logged(() =>
				expect(
					measureRequest(fakeContext(), async () => {
						throw new Error("render failed");
					}),
				).rejects.toThrow("render failed"),
			);
			expect(lines).toMatchObject([{ event: "request", status: 500 }]);
			expect(totals.inFlight).toBe(0);
		});

		test("the queue totals are refused to anyone but the system and admins", async () => {
			const totalsNow = await db.gradingJob.totals({ actor: SYSTEM });
			expect(totalsNow.submissions).toBeGreaterThanOrEqual(0);
			expect(Object.keys(totalsNow.jobs).sort()).toEqual([
				"CANCELLED",
				"CLAIMED",
				"DONE",
				"FAILED",
				"QUEUED",
			]);
			await expect(
				db.gradingJob.totals({
					actor: { role: "STUDENT", name: "Ana", username: "ana" },
				}),
			).rejects.toThrow(NotAllowed);
		});

		test("timing a service call costs about a microsecond", async () => {
			const settings = { ...PERF };
			PERF.enabled = true;
			PERF.slowServiceMs = 1000;
			const settled = Promise.resolve();
			const batches = 200;
			const size = 1000;
			try {
				let total = 0;
				for (let batch = 0; batch < batches; batch++) {
					const start = performance.now();
					for (let i = 0; i < size; i++) {
						const call = beginServiceCall("thing.fast", false, SYSTEM);
						if (call) endServiceCall(call, settled);
					}
					// Lets the calls of the batch close before the next one.
					await settled;
					await settled;
					total += performance.now() - start;
				}
				const perCallUs = (total * 1000) / (batches * size);
				// Measured at ~0.7 µs; the bound only catches a regression by an order of magnitude.
				expect(perCallUs).toBeLessThan(10);
			} finally {
				Object.assign(PERF, settings);
			}
		});
	});
