/**
 * Where a run's port lands when nothing else is listening there.
 *
 * Its own module so `test/run.ts` can read it without importing `test/env.ts`,
 * which derives every other path from `TEST_PORT` the moment it is first
 * imported — too early for the runner, which sets `TEST_PORT` itself.
 */
export const DEFAULT_TEST_PORT = 4322;
