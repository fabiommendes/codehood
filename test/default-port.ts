import { availableParallelism } from "node:os";

/**
 * Where a run's port lands when nothing else is listening there.
 *
 * Its own module so `test/run.ts` can read it without importing `test/env.ts`,
 * which derives every other path from `TEST_PORT` the moment it is first
 * imported — too early for the runner, which sets `TEST_PORT` itself.
 */
export const DEFAULT_TEST_PORT = 4322;

/// How many `e2e` workers, and so servers and ports, a run takes unless
/// `TEST_E2E_WORKERS` says otherwise: half the cores, at most 4. Each worker
/// keeps a browser and a server busy, and past 4 the suite only gets less
/// stable. Here for the same reason as the port.
export const DEFAULT_E2E_WORKERS = Math.min(
	4,
	Math.max(1, Math.floor(availableParallelism() / 2)),
);
