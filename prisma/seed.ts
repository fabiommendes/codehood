import { ensureDemoCourses, ensureDevAdmin } from "@/auth/bootstrap";

await ensureDevAdmin();
await ensureDemoCourses();
