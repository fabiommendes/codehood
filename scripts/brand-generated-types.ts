import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRANDING, brandSource } from "@/db/branding";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const generatedModelsPath = path.join(
	rootDir,
	"src",
	"generated",
	"prisma",
	"models",
);

for (const model in BRANDING) {
	const modPath = path.join(generatedModelsPath, `${model}.ts`);
	const source = readFileSync(modPath, { encoding: "utf-8" });
	const newSource = brandSource({ model, source });

	writeFileSync(modPath, newSource, { encoding: "utf-8" });
	console.log(`Wrote ${path.relative(rootDir, modPath)}`);
}
