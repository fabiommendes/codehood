import { expect, test } from "@playwright/test";
import { pretestOffReason } from "@/components/exam/code-pretest";
import { withModuleHeader } from "@/components/runner/test-report";

test.describe("pretestOffReason", () => {
	test("a missing runner switches the button off", () => {
		expect(pretestOffReason(2, null)).toBe("no-runner");
		expect(pretestOffReason(2, undefined)).toBe("no-runner");
		expect(pretestOffReason(0, null)).toBe("no-runner");
	});

	test("a runner without pretests switches it off for that reason", () => {
		expect(pretestOffReason(0, "http://127.0.0.1:4322")).toBe("no-pretests");
	});

	test("a runner and pretests leave it on", () => {
		expect(pretestOffReason(1, "http://127.0.0.1:4322")).toBeNull();
	});
});

test.describe("withModuleHeader", () => {
	test("prepends the header named after the file", () => {
		expect(withModuleHeader("elm", "Main.elm", "f = 1\n")).toBe(
			"module Main exposing (..)\n\nf = 1\n",
		);
	});

	test("turns slashes of the file into dots", () => {
		expect(withModuleHeader("elm", "Foo/Bar.elm", "f = 1")).toBe(
			"module Foo.Bar exposing (..)\n\nf = 1",
		);
	});

	test("keeps an answer that declares a module", () => {
		const text = "module Other exposing (f)\n\nf = 1\n";
		expect(withModuleHeader("elm", "Main.elm", text)).toBe(text);
	});

	test("leaves other languages alone", () => {
		expect(withModuleHeader("python", "main.py", "x = 1")).toBe("x = 1");
	});
});
