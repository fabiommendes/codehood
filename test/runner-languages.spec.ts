import { expect, test } from "@playwright/test";
import {
	defaultFilename,
	defaultRunMode,
	runnerLanguage,
} from "@/runner/languages";

test("Prolog tags map to prolog, which starts in repl mode", () => {
	for (const tag of ["pl", "prolog", "SWIPL"]) {
		expect(runnerLanguage(tag)).toBe("prolog");
	}
	expect(defaultFilename("prolog")).toBe("main.pl");
	expect(defaultRunMode("prolog")).toBe("repl");
	expect(defaultRunMode("javascript")).toBe("script");
});

test("JavaScript aliases map to javascript", () => {
	for (const tag of ["javascript", "js", "mjs", "node"]) {
		expect(runnerLanguage(tag)).toBe("javascript");
	}
});

test("tags are case-insensitive and trimmed", () => {
	expect(runnerLanguage("JS")).toBe("javascript");
	expect(runnerLanguage("JavaScript")).toBe("javascript");
	expect(runnerLanguage(" js ")).toBe("javascript");
});

test("null, undefined and empty tags have no driver", () => {
	expect(runnerLanguage(null)).toBeNull();
	expect(runnerLanguage(undefined)).toBeNull();
	expect(runnerLanguage("")).toBeNull();
});

test("the fake driver is never reachable from a tag", () => {
	expect(runnerLanguage("fake")).toBeNull();
});

test("languages without a driver map to null", () => {
	for (const tag of ["python", "haskell", "typescript", "lua"]) {
		expect(runnerLanguage(tag)).toBeNull();
	}
});

test("object prototype keys are not languages", () => {
	for (const tag of [
		"constructor",
		"__proto__",
		"toString",
		"hasOwnProperty",
	]) {
		expect(runnerLanguage(tag)).toBeNull();
	}
});

test("defaultFilename gives each language its extension", () => {
	expect(defaultFilename("javascript")).toBe("main.js");
});
