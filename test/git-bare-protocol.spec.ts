import { PassThrough, type Readable } from "node:stream";
import { expect, test } from "@playwright/test";
import {
	advertiseRefs,
	createBareRepository,
	GitBusyError,
	GitTimeoutError,
	readMain,
	uploadPack,
} from "@/services/git/bare";
import {
	cleanupGitTest,
	cloneInto,
	commitFiles,
	defaultRules,
	freshTeamId,
	type GitServer,
	git,
	startGitServer,
} from "./git-server";

/// The smart HTTP plumbing of a bare repository: a real clone/push round trip,
/// and the ceilings on concurrent operations, which are global to the process.

let server: GitServer;

test.beforeAll(async () => {
	server = await startGitServer(() => defaultRules());
});

test.afterAll(async () => {
	await server.close();
});

test.afterEach(() => {
	cleanupGitTest();
});

/** Resolves when the stream ends, closes or fails; never rejects. */
function settled(stream: Readable): Promise<void> {
	return new Promise((resolve) => {
		// A stream that already settled never emits these events again.
		if (stream.destroyed || stream.readableEnded) return resolve();
		stream.once("end", resolve);
		stream.once("close", resolve);
		stream.once("error", () => resolve());
		stream.resume();
	});
}

/** An operation held open by an input that never ends. */
type Held = { input: PassThrough; output: Readable };

function hold(teamId: number, key: string, timeoutMs?: number): Held {
	const input = new PassThrough();
	const output = uploadPack(
		teamId,
		input,
		key,
		timeoutMs === undefined ? undefined : { timeoutMs },
	);
	output.on("error", () => {});
	output.resume();
	return { input, output };
}

/** Lets the operation go and waits for it to finish. */
async function release(held: Held): Promise<void> {
	held.input.destroy();
	await settled(held.output);
}

/// Waits until a slot for `key` is free, without sleeping a fixed time.
async function expectSlotFree(teamId: number, key: string): Promise<void> {
	await expect
		.poll(async () => {
			try {
				await release(hold(teamId, key));
				return true;
			} catch (error) {
				if (error instanceof GitBusyError) return false;
				throw error;
			}
		})
		.toBe(true);
}

test.describe("round trip over smart HTTP", () => {
	test("clone, commit, push, and another clone sees the commit", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const first = await cloneInto(server.url(id, "key"));
		const sha = await commitFiles(first, { "hello.txt": "hello\n" });
		const pushed = await git(first, ["push", "origin", "main"], {
			allowFail: true,
		});
		expect(pushed.code, pushed.stderr).toBe(0);
		expect(await readMain(id)).toBe(sha);

		const second = await cloneInto(server.url(id, "other-key"));
		expect((await git(second, ["rev-parse", "HEAD"])).stdout.trim()).toBe(sha);
		expect((await git(second, ["show", "HEAD:hello.txt"])).stdout).toBe(
			"hello\n",
		);
	});

	test("the first push into an empty repository works", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const dir = await cloneInto(server.url(id, "key"));
		await commitFiles(dir, { "a.txt": "a\n" });
		const pushed = await git(dir, ["push", "origin", "main"], {
			allowFail: true,
		});
		expect(pushed.code, pushed.stderr).toBe(0);
		expect(await readMain(id)).not.toBeNull();
	});

	test("advertiseRefs starts with the service pkt-line and a flush", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		for (const service of ["git-upload-pack", "git-receive-pack"] as const) {
			const body = await advertiseRefs(id, service, "key");
			const line = `# service=${service}\n`;
			const length = (line.length + 4).toString(16).padStart(4, "0");
			expect(body.subarray(0, line.length + 8).toString()).toBe(
				`${length}${line}0000`,
			);
		}
	});
});

test.describe("ceilings on concurrent operations", () => {
	test.describe.configure({ mode: "serial" });

	test("a second operation with the same key throws GitBusyError at once, another key passes", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const first = hold(id, "same");
		try {
			let caught: unknown;
			try {
				uploadPack(id, new PassThrough(), "same");
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(GitBusyError);
			expect((caught as GitBusyError).retryAfterSeconds).toBeGreaterThan(0);
			await expect(
				advertiseRefs(id, "git-upload-pack", "same"),
			).rejects.toBeInstanceOf(GitBusyError);

			const other = hold(id, "different");
			await release(other);
		} finally {
			await release(first);
		}
	});

	test("the fifth simultaneous operation throws GitBusyError", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const held: Held[] = [];
		try {
			for (const key of ["k1", "k2", "k3", "k4"]) held.push(hold(id, key));
			expect(() => uploadPack(id, new PassThrough(), "k5")).toThrow(
				GitBusyError,
			);
		} finally {
			await Promise.all(held.map(release));
		}
	});

	test("the slot is freed after the operation finishes normally", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const op = hold(id, "key");
		try {
			op.input.end("0000");
			await settled(op.output);
			await expectSlotFree(id, "key");
		} finally {
			await release(op);
		}
	});

	test("the slot is freed after an operation fails", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const op = hold(id, "key");
		try {
			op.input.destroy(new Error("client went away"));
			await settled(op.output);
			await expectSlotFree(id, "key");
		} finally {
			await release(op);
		}
	});

	test("the slot is freed after an operation times out", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const op = hold(id, "key", 200);
		try {
			await settled(op.output);
			await expectSlotFree(id, "key");
		} finally {
			await release(op);
		}
	});

	test("a stuck operation errors with GitTimeoutError in under 2 seconds", async () => {
		const id = freshTeamId();
		await createBareRepository(id);
		const input = new PassThrough();
		const started = Date.now();
		const output = uploadPack(id, input, "key", { timeoutMs: 200 });
		try {
			const error = await new Promise<unknown>((resolve) => {
				output.once("error", resolve);
				output.resume();
			});
			expect(error).toBeInstanceOf(GitTimeoutError);
			expect(Date.now() - started).toBeLessThan(2000);
		} finally {
			input.destroy();
			await settled(output);
		}
	});
});
