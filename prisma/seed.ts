import { ensureDemoCourses, ensureDevAdmin } from "@/db/bootstrap";

await ensureDevAdmin();
await ensureDemoCourses();
