/**
 * Generates `src/mdq/schemas-generated.ts` -- Zod schemas and inferred types
 * for every MDQ document shape -- from the bundled JSON Schema at
 * `public/mdq.schema.json`.
 *
 * This is a purpose-built converter for exactly the subset of JSON Schema
 * that file uses, not a generic json-schema-to-zod tool: it understands this
 * schema's `$ref` bundling scheme (see `resolveRef` below) and throws loudly
 * on any keyword or construct it does not recognize, so a future spec
 * revision fails the generator instead of silently dropping fields.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const thisFile = fileURLToPath(import.meta.url);

/**
 * Runs the generated source through Biome's formatter (in stdin mode), so the
 * returned text is already tab-indented and double-quoted, matching what
 * `biome ci` expects. Deliberately the formatter only, not `check --write`:
 * the module's bytes must not depend on which lint rules a given Biome
 * version happens to autofix (e.g. `useRegexLiterals`), only on formatting
 * rules -- which we do need, since `renderObjectLiteral` emits a flat
 * one-tab indent regardless of nesting depth and relies on Biome to reflow
 * long lines.
 */
function formatWithBiome(source: string): string {
	const biomeBin = path.join(rootDir, "node_modules", ".bin", "biome");
	return execFileSync(
		biomeBin,
		["format", "--stdin-file-path=schemas-generated.ts"],
		{
			input: source,
			encoding: "utf-8",
		},
	);
}

type Json = string | number | boolean | null | Json[] | JsonObject;
type JsonObject = { [key: string]: Json };

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keys ignored everywhere: they carry no structural meaning for Zod. */
const GLOBALLY_IGNORED_KEYS = new Set([
	"$schema",
	"$id",
	"title",
	"examples",
	"format",
]);

/** `description` and `default` are consumed (into JSDoc), never dropped silently. */
const GLOBALLY_CONSUMED_KEYS = new Set(["description", "default"]);

function assertKnownKeys(node: JsonObject, known: string[], label: string) {
	const allowed = new Set([
		...known,
		...GLOBALLY_IGNORED_KEYS,
		...GLOBALLY_CONSUMED_KEYS,
	]);
	const extra = Object.keys(node).filter((key) => !allowed.has(key));
	if (extra.length > 0) {
		throw new Error(
			`Unsupported keyword(s) [${extra.join(", ")}] in ${label}: ${JSON.stringify(node)}`,
		);
	}
}

function getString(node: JsonObject, key: string, label: string): string {
	const value = node[key];
	if (typeof value !== "string") {
		throw new Error(`Expected "${key}" to be a string in ${label}`);
	}
	return value;
}

/** Notes about JSON Schema constraints this generator cannot express in Zod. */
const unenforcedConstraints: string[] = [];

function noteUnenforced(label: string, constraint: string) {
	unenforcedConstraints.push(`${label}: ${constraint} (not enforced by Zod)`);
}

// ---------------------------------------------------------------------------
// $ref resolution
// ---------------------------------------------------------------------------

/** Maps an absolute `$id` URL, or its bare filename, to the subschema node it names. */
let idMap: Map<string, JsonObject>;
let filenameMap: Map<string, JsonObject>;

function buildIdMaps(root: JsonObject) {
	idMap = new Map();
	filenameMap = new Map();
	const defs = getObject(root, "$defs", "root");
	for (const node of Object.values(defs)) {
		const obj = requireObject(node, "root $defs entry");
		const id = getString(obj, "$id", "root $defs entry");
		idMap.set(id, obj);
		const filename = id.split("/").pop();
		if (!filename) {
			throw new Error(`Could not derive a filename from $id ${id}`);
		}
		filenameMap.set(filename, obj);
	}
}

function requireObject(value: Json, label: string): JsonObject {
	if (!isObject(value)) {
		throw new Error(
			`Expected an object in ${label}, got ${JSON.stringify(value)}`,
		);
	}
	return value;
}

function getObject(node: JsonObject, key: string, label: string): JsonObject {
	return requireObject(node[key], `${label}.${key}`);
}

interface RefContext {
	/** The nearest enclosing subschema that declares an `$id`, for local `#/...` refs. */
	enclosingNode: JsonObject;
	label: string;
}

function navigateFragment(
	node: JsonObject,
	fragment: string,
	ref: string,
	label: string,
): Json {
	const segments = fragment.split("/").filter(Boolean).map(decodeURIComponent);
	let current: Json = node;
	for (const segment of segments) {
		if (!isObject(current) || !(segment in current)) {
			throw new Error(
				`Cannot resolve fragment segment "${segment}" of $ref "${ref}" in ${label}`,
			);
		}
		current = current[segment];
	}
	return current;
}

function resolveRef(ref: string, ctx: RefContext): JsonObject {
	const hashIndex = ref.indexOf("#");
	const base = hashIndex === -1 ? ref : ref.slice(0, hashIndex);
	const fragment = hashIndex === -1 ? "" : ref.slice(hashIndex + 1);

	let target: JsonObject;
	if (base === "") {
		target = ctx.enclosingNode;
	} else if (base.startsWith("http://") || base.startsWith("https://")) {
		const found = idMap.get(base);
		if (!found) {
			throw new Error(`Unresolved $id reference "${base}" in ${ctx.label}`);
		}
		target = found;
	} else {
		const filename = base.replace(/^\.\//, "");
		const found = filenameMap.get(filename);
		if (!found) {
			throw new Error(
				`Unresolved relative reference "${base}" in ${ctx.label}`,
			);
		}
		target = found;
	}

	if (fragment) {
		target = requireObject(
			navigateFragment(target, fragment, ref, ctx.label),
			`$ref "${ref}" in ${ctx.label}`,
		);
	}
	return target;
}

// ---------------------------------------------------------------------------
// Named schema registry
// ---------------------------------------------------------------------------

type DefKind = "flatten" | "node";

interface DefEntry {
	name: string;
	node: JsonObject;
	/** The nearest enclosing `$id`-bearing node, for resolving local `#/...` refs inside `node`. */
	enclosingNode: JsonObject;
	kind: DefKind;
	schemaConstName: string;
	generated: boolean;
	generating: boolean;
	bodyExpr?: string;
	deps: Set<string>;
	/** True once generated, if the object exposes a `type` const property (for union auto-detection). */
	hasTypeConst: boolean;
}

const nodeToEntry = new Map<JsonObject, DefEntry>();
const nameToEntry = new Map<string, DefEntry>();
const emissionOrder: DefEntry[] = [];

function pascalCase(kebab: string): string {
	return kebab
		.split(/[-_]/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join("");
}

function registerEntry(
	name: string,
	node: JsonObject,
	enclosingNode: JsonObject,
	kind: DefKind,
): DefEntry {
	if (nameToEntry.has(name)) {
		throw new Error(`Duplicate generated schema name "${name}"`);
	}
	const entry: DefEntry = {
		name,
		node,
		enclosingNode,
		kind,
		schemaConstName: `${name}Schema`,
		generated: false,
		generating: false,
		deps: new Set(),
		hasTypeConst: false,
	};
	nodeToEntry.set(node, entry);
	nameToEntry.set(name, entry);
	return entry;
}

function registerAllDefs(root: JsonObject) {
	const defs = getObject(root, "$defs", "root");
	for (const [kebabKey, rawNode] of Object.entries(defs)) {
		const node = requireObject(rawNode, `$defs.${kebabKey}`);
		const name = pascalCase(kebabKey);
		const kind: DefKind = "allOf" in node ? "flatten" : "node";
		registerEntry(name, node, node, kind);

		if ("$defs" in node) {
			const nestedDefs = getObject(node, "$defs", `$defs.${kebabKey}.$defs`);
			for (const [nestedKey, rawNested] of Object.entries(nestedDefs)) {
				const nestedNode = requireObject(
					rawNested,
					`$defs.${kebabKey}.$defs.${nestedKey}`,
				);
				const nestedName = `${name}${pascalCase(nestedKey)}`;
				const nestedKind: DefKind = "allOf" in nestedNode ? "flatten" : "node";
				registerEntry(nestedName, nestedNode, node, nestedKind);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Compiling schema nodes to Zod expressions
// ---------------------------------------------------------------------------

interface CompileCtx extends RefContext {
	currentEntry: DefEntry;
}

function ensureGenerated(entry: DefEntry): DefEntry {
	if (entry.generated) {
		return entry;
	}
	if (entry.generating) {
		throw new Error(`Reference cycle detected involving "${entry.name}"`);
	}
	entry.generating = true;
	const ctx: CompileCtx = {
		enclosingNode: entry.enclosingNode,
		label: entry.name,
		currentEntry: entry,
	};
	entry.bodyExpr =
		entry.kind === "flatten"
			? compileFlattenedDef(entry.node, ctx)
			: compileNode(entry.node, ctx);
	entry.generating = false;
	entry.generated = true;
	emissionOrder.push(entry);
	return entry;
}

function compileRef(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["$ref"], ctx.label);
	const ref = getString(node, "$ref", ctx.label);
	const target = resolveRef(ref, ctx);
	const entry = nodeToEntry.get(target);
	if (!entry) {
		throw new Error(
			`$ref "${ref}" in ${ctx.label} does not resolve to a registered named schema`,
		);
	}
	ensureGenerated(entry);
	ctx.currentEntry.deps.add(entry.name);
	return entry.schemaConstName;
}

function emitRegex(pattern: string): string {
	// A JS regex literal is delimited by "/", so any "/" in the pattern (e.g.
	// the `include` path pattern in exam.yaml) must be escaped to "\/" -- the
	// only escaping a literal requires here, since none of these patterns
	// contain a raw newline. Emitted directly as a literal (not
	// `new RegExp(...)`) so the output does not depend on a lint autofix.
	const escaped = pattern.replace(/\//g, "\\/");
	return `/${escaped}/`;
}

function compileString(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(
		node,
		["type", "minLength", "maxLength", "pattern"],
		ctx.label,
	);
	let expr = "z.string()";
	if (typeof node.minLength === "number") {
		expr += `.min(${node.minLength})`;
	}
	if (typeof node.maxLength === "number") {
		expr += `.max(${node.maxLength})`;
	}
	if (typeof node.pattern === "string") {
		expr += `.regex(${emitRegex(node.pattern)})`;
	}
	return expr;
}

function compileNumber(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["type", "minimum", "maximum"], ctx.label);
	let expr = "z.number()";
	if (typeof node.minimum === "number") {
		expr += `.min(${node.minimum})`;
	}
	if (typeof node.maximum === "number") {
		expr += `.max(${node.maximum})`;
	}
	return expr;
}

function compileInteger(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["type", "minimum", "maximum"], ctx.label);
	let expr = "z.int()";
	if (typeof node.minimum === "number") {
		expr += `.min(${node.minimum})`;
	}
	if (typeof node.maximum === "number") {
		expr += `.max(${node.maximum})`;
	}
	return expr;
}

function compileBoolean(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["type"], ctx.label);
	return "z.boolean()";
}

function compileEnum(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["enum", "type"], ctx.label);
	const values = node.enum;
	if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) {
		throw new Error(
			`Expected "enum" to be an array of strings in ${ctx.label}`,
		);
	}
	return `z.enum([${values.map((v) => JSON.stringify(v)).join(", ")}])`;
}

function compileConst(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["const"], ctx.label);
	const value = node.const;
	if (typeof value !== "string") {
		throw new Error(
			`Only string "const" values are supported (in ${ctx.label})`,
		);
	}
	return `z.literal(${JSON.stringify(value)})`;
}

function compileArray(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(
		node,
		["type", "items", "minItems", "uniqueItems"],
		ctx.label,
	);
	const itemsNode = requireObject(node.items, `${ctx.label}.items`);
	const itemExpr = compileNode(itemsNode, {
		...ctx,
		label: `${ctx.label}.items`,
	});
	let expr = `z.array(${itemExpr})`;
	if (typeof node.minItems === "number") {
		expr += `.min(${node.minItems})`;
	}
	if (node.uniqueItems === true) {
		noteUnenforced(ctx.label, "uniqueItems");
	}
	return expr;
}

function compileObject(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(
		node,
		["type", "properties", "required", "additionalProperties", "$defs"],
		ctx.label,
	);
	if (node.additionalProperties === true) {
		if ("properties" in node) {
			throw new Error(
				`Unsupported: additionalProperties:true combined with properties in ${ctx.label}`,
			);
		}
		return "z.record(z.string(), z.unknown())";
	}
	const properties = isObject(node.properties) ? node.properties : {};
	const required = Array.isArray(node.required)
		? new Set(node.required as string[])
		: new Set<string>();
	const strict = node.additionalProperties === false;
	return renderObjectLiteral(properties, required, strict, ctx);
}

function compileOneOfEntries(branches: Json[], ctx: CompileCtx): DefEntry[] {
	return branches.map((branch, index) => {
		const branchNode = requireObject(branch, `${ctx.label}[${index}]`);
		assertKnownKeys(branchNode, ["$ref"], `${ctx.label}[${index}]`);
		const ref = getString(branchNode, "$ref", `${ctx.label}[${index}]`);
		const target = resolveRef(ref, ctx);
		const entry = nodeToEntry.get(target);
		if (!entry) {
			throw new Error(
				`$ref "${ref}" in ${ctx.label}[${index}] does not resolve to a registered named schema`,
			);
		}
		ensureGenerated(entry);
		ctx.currentEntry.deps.add(entry.name);
		return entry;
	});
}

function buildUnionExpr(entries: DefEntry[]): string {
	const names = entries.map((entry) => entry.schemaConstName);
	if (entries.every((entry) => entry.hasTypeConst)) {
		return `z.discriminatedUnion("type", [${names.join(", ")}])`;
	}
	return `z.union([${names.join(", ")}])`;
}

function compileOneOf(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["oneOf"], ctx.label);
	if (!Array.isArray(node.oneOf)) {
		throw new Error(`Expected "oneOf" to be an array in ${ctx.label}`);
	}
	const entries = compileOneOfEntries(node.oneOf, ctx);
	return buildUnionExpr(entries);
}

/**
 * Describes an `if`/`then` branch for the unenforced-constraints summary,
 * derived from the node itself (rather than a hardcoded description) so it
 * stays accurate if the spec grows a different conditional.
 */
function describeConditional(branchNode: JsonObject): string {
	const ifNode = isObject(branchNode.if) ? branchNode.if : undefined;
	const thenNode = isObject(branchNode.then) ? branchNode.then : undefined;
	const ifKeys =
		ifNode && isObject(ifNode.properties) ? Object.keys(ifNode.properties) : [];
	const thenKeys =
		thenNode && isObject(thenNode.properties)
			? Object.keys(thenNode.properties)
			: [];
	const parts: string[] = [];
	if (ifKeys.length > 0) {
		parts.push(`when ${ifKeys.join(", ")} matches a given value`);
	}
	if (thenKeys.length > 0) {
		parts.push(`constrains ${thenKeys.join(", ")}`);
	}
	const detail = parts.length > 0 ? parts.join(", ") : "unspecified condition";
	return `conditional if/then constraint (${detail})`;
}

function compileFlattenedDef(node: JsonObject, ctx: CompileCtx): string {
	assertKnownKeys(node, ["allOf", "unevaluatedProperties", "$defs"], ctx.label);
	if (node.unevaluatedProperties !== false) {
		throw new Error(
			`Expected "unevaluatedProperties: false" alongside "allOf" in ${ctx.label}`,
		);
	}
	if (!Array.isArray(node.allOf)) {
		throw new Error(`Expected "allOf" to be an array in ${ctx.label}`);
	}

	const mergedProperties: JsonObject = {};
	const propertyOrder: string[] = [];
	const required = new Set<string>();

	for (const branch of node.allOf) {
		let branchNode = requireObject(branch, `${ctx.label}.allOf`);
		if ("$ref" in branchNode) {
			assertKnownKeys(branchNode, ["$ref"], `${ctx.label}.allOf`);
			const ref = getString(branchNode, "$ref", `${ctx.label}.allOf`);
			branchNode = resolveRef(ref, ctx);
		}
		if (branchNode.type !== "object") {
			throw new Error(`allOf branch in ${ctx.label} is not an object schema`);
		}
		assertKnownKeys(
			branchNode,
			["type", "properties", "required", "if", "then"],
			`${ctx.label}.allOf`,
		);
		if ("if" in branchNode || "then" in branchNode) {
			noteUnenforced(ctx.label, describeConditional(branchNode));
		}
		const branchProperties = isObject(branchNode.properties)
			? branchNode.properties
			: {};
		for (const [key, value] of Object.entries(branchProperties)) {
			if (!(key in mergedProperties)) {
				propertyOrder.push(key);
			}
			mergedProperties[key] = value;
		}
		const branchRequired = Array.isArray(branchNode.required)
			? (branchNode.required as string[])
			: [];
		for (const key of branchRequired) {
			required.add(key);
		}
	}

	const orderedProperties: JsonObject = {};
	for (const key of propertyOrder) {
		orderedProperties[key] = mergedProperties[key];
	}
	return renderObjectLiteral(orderedProperties, required, true, ctx);
}

function compileNode(node: JsonObject, ctx: CompileCtx): string {
	if ("$ref" in node) {
		return compileRef(node, ctx);
	}
	if ("allOf" in node) {
		return compileFlattenedDef(node, ctx);
	}
	if ("oneOf" in node) {
		return compileOneOf(node, ctx);
	}
	if ("const" in node) {
		return compileConst(node, ctx);
	}
	if ("enum" in node) {
		return compileEnum(node, ctx);
	}
	switch (node.type) {
		case "string":
			return compileString(node, ctx);
		case "number":
			return compileNumber(node, ctx);
		case "integer":
			return compileInteger(node, ctx);
		case "boolean":
			return compileBoolean(node, ctx);
		case "array":
			return compileArray(node, ctx);
		case "object":
			return compileObject(node, ctx);
		default:
			throw new Error(
				`Unsupported schema node in ${ctx.label}: ${JSON.stringify(node)}`,
			);
	}
}

// ---------------------------------------------------------------------------
// Rendering (JSDoc-wrapped object literals, indentation, etc.)
// ---------------------------------------------------------------------------

function wrapComment(text: string, indent: string): string {
	const escaped = text.replace(/\*\//g, "*\\/");
	const words = escaped.split(/\s+/).filter(Boolean);
	const maxWidth = Math.max(40, 80 - indent.length - 3);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (current && current.length + 1 + word.length > maxWidth) {
			lines.push(current);
			current = word;
		} else {
			current = current ? `${current} ${word}` : word;
		}
	}
	if (current) {
		lines.push(current);
	}
	if (lines.length === 0) {
		return "";
	}
	if (lines.length === 1) {
		return `${indent}/** ${lines[0]} */\n`;
	}
	return `${indent}/**\n${lines.map((line) => `${indent} * ${line}`).join("\n")}\n${indent} */\n`;
}

function describeProperty(node: JsonObject): string | undefined {
	const parts: string[] = [];
	if (typeof node.description === "string") {
		parts.push(node.description);
	}
	if ("default" in node) {
		parts.push(`Defaults to \`${JSON.stringify(node.default)}\` when omitted.`);
	}
	return parts.length > 0 ? parts.join(" ") : undefined;
}

function renderObjectLiteral(
	properties: JsonObject,
	required: Set<string>,
	strict: boolean,
	ctx: CompileCtx,
): string {
	const indent = "\t";
	const lines: string[] = [];
	for (const [key, rawValue] of Object.entries(properties)) {
		const propNode = requireObject(rawValue, `${ctx.label}.properties.${key}`);
		const propCtx: CompileCtx = { ...ctx, label: `${ctx.label}.${key}` };
		let expr = compileNode(propNode, propCtx);
		if (!required.has(key)) {
			expr += ".optional()";
		}
		const description = describeProperty(propNode);
		if (description) {
			lines.push(wrapComment(description, indent).replace(/\n$/, ""));
		}
		const keyLiteral = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
			? key
			: JSON.stringify(key);
		lines.push(`${indent}${keyLiteral}: ${expr},`);
		if (key === "type" && "const" in propNode) {
			ctx.currentEntry.hasTypeConst = true;
		}
	}
	const body = lines.length > 0 ? `{\n${lines.join("\n")}\n}` : "{}";
	return `z.object(${body})${strict ? ".strict()" : ""}`;
}

function renderDescription(node: JsonObject): string | undefined {
	return typeof node.description === "string" ? node.description : undefined;
}

function renderEntry(entry: DefEntry): string {
	const description = renderDescription(entry.node);
	const doc = description ? wrapComment(description, "") : "";
	return (
		`${doc}export const ${entry.schemaConstName} = ${entry.bodyExpr};\n` +
		`export type ${entry.name} = z.infer<typeof ${entry.schemaConstName}>;\n`
	);
}

// ---------------------------------------------------------------------------
// Root union exports: MdqDocument (all 8 kinds) and Question (7, no exam)
// ---------------------------------------------------------------------------

function buildRootUnionEntry(
	name: string,
	description: string,
	entries: DefEntry[],
): DefEntry {
	const syntheticNode: JsonObject = { description };
	const entry: DefEntry = {
		name,
		node: syntheticNode,
		enclosingNode: syntheticNode,
		kind: "node",
		schemaConstName: `${name}Schema`,
		generated: false,
		generating: false,
		deps: new Set(entries.map((e) => e.name)),
		hasTypeConst: false,
	};
	entry.bodyExpr = buildUnionExpr(entries);
	entry.generated = true;
	nameToEntry.set(name, entry);
	emissionOrder.push(entry);
	return entry;
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------

export function renderModule(schema: unknown): string {
	unenforcedConstraints.length = 0;
	nodeToEntry.clear();
	nameToEntry.clear();
	emissionOrder.length = 0;

	const root = requireObject(schema as Json, "root");
	buildIdMaps(root);
	registerAllDefs(root);

	for (const entry of nodeToEntry.values()) {
		ensureGenerated(entry);
	}

	if (!Array.isArray(root.oneOf)) {
		throw new Error('Expected the root schema to have a "oneOf"');
	}
	const rootCtx: CompileCtx = {
		enclosingNode: root,
		label: "root.oneOf",
		currentEntry: {
			name: "root",
			node: root,
			enclosingNode: root,
			kind: "node",
			schemaConstName: "",
			generated: true,
			generating: false,
			deps: new Set(),
			hasTypeConst: false,
		},
	};
	const rootEntries = compileOneOfEntries(root.oneOf, rootCtx);
	const examEntry = rootEntries.find((entry) => entry.name === "Exam");
	const questionEntries = rootEntries.filter((entry) => entry.name !== "Exam");
	if (!examEntry) {
		throw new Error(
			'Expected root.oneOf to include a branch resolving to "Exam"',
		);
	}

	const questionEntry = buildRootUnionEntry(
		"Question",
		"Any single MDQ question document: one of the seven question types, discriminated by `type`.",
		questionEntries,
	);
	buildRootUnionEntry(
		"MdqDocument",
		"Any MDQ document: an exam, or one of the seven question types.",
		[questionEntry, examEntry],
	);

	const header = `/**
 * AUTOGENERATED -- DO NOT EDIT BY HAND.
 *
 * Generated by \`scripts/generate-question-models.ts\` from
 * \`public/mdq.schema.json\`. Run \`pnpm run question-models\` to regenerate.
 */
import { z } from "zod";

`;

	const body = emissionOrder.map((entry) => renderEntry(entry)).join("\n");
	return formatWithBiome(header + body);
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
	const schemaPath = path.join(rootDir, "public", "mdq.schema.json");
	const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
	const module = renderModule(schema);
	const outPath = path.join(rootDir, "src", "mdq", "schemas-generated.ts");
	writeFileSync(outPath, module);
	console.log(`Wrote ${path.relative(rootDir, outPath)}`);
	if (unenforcedConstraints.length > 0) {
		console.log("Unenforced JSON Schema constraints (by design):");
		for (const line of unenforcedConstraints) {
			console.log(`  - ${line}`);
		}
	}
}
