/**
 * Checks that the message catalogue is complete; exits 1 when it is not.
 */
import { checkCatalog, loadCatalog } from "./lib/i18n-catalog";

const problems = checkCatalog(loadCatalog(process.cwd()));
for (const problem of problems) console.error(problem.message);
process.exit(problems.length > 0 ? 1 : 0);
