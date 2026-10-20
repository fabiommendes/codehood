/**
 * Compiles the Paraglide messages into `src/generated/paraglide`.
 */
import { fileURLToPath } from "node:url";
import { compile } from "@inlang/paraglide-js";
import { paraglideOptions } from "./lib/paraglide";

const root = fileURLToPath(new URL("..", import.meta.url));
await compile(paraglideOptions(root));
