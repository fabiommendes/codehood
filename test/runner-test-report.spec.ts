import { expect, test } from "@playwright/test";
import {
	elmCases,
	elmModule,
	locateElmCase,
	parseSuite,
} from "@/components/runner/test-report";

const PRE = `module Pre exposing (tests)

import Expect
import Main exposing (soma)
import Test exposing (Test, describe, test)


-- mdq: [0] {public} Soma a lista vazia e um elemento
tests : Test
tests =
    describe "pre"
        [ test "vazia" <| \\_ -> Expect.equal 0 (soma [])
        , test "um" <| \\_ -> Expect.equal 7 (soma [ 7 ])
        ]
`;

test.describe("locateElmCase", () => {
	test("finds the line of the test literal", () => {
		expect(locateElmCase(PRE, ["pre", "vazia"])).toBe(12);
		expect(locateElmCase(PRE, ["pre", "um"])).toBe(13);
	});

	test("omits an unknown name", () => {
		expect(locateElmCase(PRE, ["pre", "nope"])).toBeUndefined();
	});

	test("tells equal names apart by the parent describe", () => {
		const src = [
			"module T exposing (tests)",
			"tests =",
			'    describe "all"',
			'        [ describe "a"',
			'            [ test "x" <| \\_ -> Expect.pass ]',
			'        , describe "b"',
			'            [ test "x" <| \\_ -> Expect.pass ]',
			"        ]",
		].join("\n");
		expect(locateElmCase(src, ["all", "a", "x"])).toBe(5);
		expect(locateElmCase(src, ["all", "b", "x"])).toBe(7);
	});

	test("handles fuzz, todo and escaped quotes", () => {
		const src = [
			"module F exposing (tests)",
			"tests =",
			'    describe "f"',
			'        [ fuzz Fuzz.int "inteiro" <| \\n -> Expect.pass',
			'        , fuzz2 Fuzz.int Fuzz.int "dois" <| \\a b -> Expect.pass',
			'        , todo "depois"',
			'        , test "diz \\"oi\\"" <| \\_ -> Expect.pass',
			"        ]",
		].join("\n");
		expect(locateElmCase(src, ["f", "inteiro"])).toBe(4);
		expect(locateElmCase(src, ["f", "dois"])).toBe(5);
		expect(locateElmCase(src, ["f", "depois"])).toBe(6);
		expect(locateElmCase(src, ["f", 'diz "oi"'])).toBe(7);
	});
});

test.describe("elmCases", () => {
	test("builds report cases with source, line and id", () => {
		const cases = elmCases(1, PRE, [
			{ labels: ["pre", "vazia"], verdict: "pass" },
			{
				labels: ["pre", "um"],
				verdict: "fail",
				message: "boom",
				expected: "7",
				actual: "0",
			},
			{ labels: ["pre", "sumiu"], verdict: "pass" },
		]);
		expect(cases).toEqual([
			{ source: 1, line: 12, verdict: "pass", id: "pre > vazia" },
			{
				source: 1,
				line: 13,
				verdict: "fail",
				id: "pre > um",
				message: "boom",
				expected: "7",
				actual: "0",
			},
			{ source: 1, verdict: "pass", id: "pre > sumiu" },
		]);
	});
});

test.describe("parseSuite and elmModule", () => {
	test("parses cases and invalid, and rejects other text", () => {
		expect(parseSuite('{"cases":[]}')).toEqual({ cases: [] });
		expect(parseSuite('{"invalid":"dup"}')).toEqual({ invalid: "dup" });
		expect(parseSuite("TEST RUN PASSED")).toBeNull();
		expect(parseSuite('{"x":1}')).toBeNull();
	});

	test("reads the module header", () => {
		expect(elmModule(PRE)).toBe("Pre");
		expect(elmModule("port module A.B exposing (..)\n")).toBe("A.B");
		expect(elmModule("x = 1\n")).toBeNull();
	});
});
