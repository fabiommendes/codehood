import { readFileSync } from "node:fs";
import path from "node:path";
import { buildOpenApiDocument } from "@/api/registry/openapi-document";
import { expect, test } from "./fixtures";

/// The CLI's copy of the document, from which its client is generated.
const SNAPSHOT = path.resolve(
	import.meta.dirname,
	"../cli/resources/openapi/codehood.json",
);

test("the CLI's OpenAPI snapshot is up to date", () => {
	const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
	// Round trip through JSON, as the generator writes it, so `undefined`
	// members do not count as a difference.
	const current = JSON.parse(JSON.stringify(buildOpenApiDocument()));
	expect(
		current,
		"cli/resources/openapi/codehood.json is out of date with the REST API. " +
			"Run `pnpm run openapi:cli` and commit the result.",
	).toEqual(snapshot);
});
