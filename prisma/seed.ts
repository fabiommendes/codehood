// The seed runs as its own process (`tsx prisma/seed.ts`), spawned by the
// Prisma CLI and by the test runner. Neither passes `.env` along, and
// `ENVIRONMENT` has no default, so load it here rather than inherit it.
// `dotenv` never overrides a variable already set, so the test runner's
// DATABASE_URL still wins over the one in `.env`.
import "dotenv/config";
import { ensureDemoCourses, ensureDevAdmin } from "@/db/bootstrap";

await ensureDevAdmin();
await ensureDemoCourses();
