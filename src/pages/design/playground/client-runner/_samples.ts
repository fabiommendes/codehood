/// Code and terminal transcripts shared by the client runner playground pages.

/// One line already written to the mock terminal.
export interface TerminalLine {
	kind: "out" | "err" | "in" | "sys" | "warn";
	text: string;
}

export const PY_AREA = `
def area(width, height):
    """Area of a rectangle."""
    return width * height

w = int(input("Width: "))
h = int(input("Height: "))
print("Area:", area(w, h))
`;

export const PY_AREA_SERVER = `
def area(width, height):
    return width * height

print(area(3, 4))
`;

export const PY_FIB = `
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

for i in range(10):
    print(i, fib(i))
`;

export const PY_BUG = `
def mean(values):
    return sum(values) / len(values)

print(mean([]))
`;

export const PY_LOOP = `
# Count down from 10
n = 10
while n > 0:
    print(n)
    # n = n - 1
`;

export const PY_SNIPPET = `
# Greenhouse sensor reading
temps = [21.5, 22.0, 23.8, 25.1, 24.4]
average = sum(temps) / len(temps)
print(f"Average: {average:.1f} °C")
print("Max:", max(temps))
`;

export const PROLOG_FAMILY = `
% Facts
parent(tom, bob).
parent(bob, ann).
parent(bob, pat).

% Rules
grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
sibling(X, Y) :- parent(P, X), parent(P, Y), X \\= Y.
`;

export const JS_SUM = `
function sum(list) {
  let total = 0;
  for (const value of list) total += value;
  return total;
}

console.log(sum([1, 2, 3, 4]));
`;

export const LUA_FACT = `
local function fact(n)
  if n == 0 then return 1 end
  return n * fact(n - 1)
end

print(fact(10))
`;

export const TERM_INPUT: TerminalLine[] = [
	{ kind: "out", text: "Width: 3" },
	{ kind: "out", text: "Height: " },
];

export const TERM_DONE: TerminalLine[] = [
	{ kind: "out", text: "Width: 3" },
	{ kind: "out", text: "Height: 4" },
	{ kind: "out", text: "Area: 12" },
];

export const TERM_FIB: TerminalLine[] = [
	{ kind: "out", text: "0 0" },
	{ kind: "out", text: "1 1" },
	{ kind: "out", text: "2 1" },
	{ kind: "out", text: "3 2" },
	{ kind: "out", text: "4 3" },
	{ kind: "out", text: "5 5" },
];

export const TERM_ERROR: TerminalLine[] = [
	{ kind: "err", text: "Traceback (most recent call last):" },
	{ kind: "err", text: '  File "main.py", line 4, in <module>' },
	{ kind: "err", text: "    print(mean([]))" },
	{ kind: "err", text: '  File "main.py", line 2, in mean' },
	{ kind: "err", text: "    return sum(values) / len(values)" },
	{ kind: "err", text: "ZeroDivisionError: division by zero" },
];

export const TERM_TRUNCATED: TerminalLine[] = [
	{ kind: "out", text: "10" },
	{ kind: "out", text: "10" },
	{ kind: "out", text: "10" },
	{ kind: "out", text: "10" },
	{ kind: "out", text: "10" },
	{
		kind: "warn",
		text: "Output limit reached (10,000 lines). The program was stopped.",
	},
];

export const TERM_STOPPED: TerminalLine[] = [
	{ kind: "out", text: "10" },
	{ kind: "out", text: "10" },
	{ kind: "out", text: "10" },
	{ kind: "sys", text: "^C Process stopped." },
];

export const TERM_LINK: TerminalLine[] = [
	{
		kind: "out",
		text: "Docs: https://docs.python.org/3/library/functions.html#input",
	},
	{ kind: "out", text: "Width: 3" },
	{ kind: "out", text: "Height: 4" },
	{ kind: "out", text: "Area: 12" },
];

export const PROLOG_BROKEN = `
parent(tom, bob).
parent(bob, ann)
parent(bob, pat).
`;

export const TERM_PROLOG_ERROR: TerminalLine[] = [
	{ kind: "err", text: "main.pl:3:1: Syntax error: Operator expected" },
	{ kind: "sys", text: "% main.pl consulted with 1 error" },
	{ kind: "in", text: "?- " },
];

export const PY_AREA_MODIFIED = `
def area(width, height):
    """Area of a rectangle."""
    return width * height

print("Area:", area(-3, 4))  # teacher: negative input?
`;

export const TERM_MODIFIED: TerminalLine[] = [
	{ kind: "out", text: "Area: -12" },
];

export const TERM_PROLOG: TerminalLine[] = [
	{ kind: "sys", text: "% main.pl consulted" },
	{ kind: "in", text: "?- grandparent(tom, Who)." },
	{ kind: "out", text: "Who = ann ;" },
	{ kind: "out", text: "Who = pat." },
	{ kind: "in", text: "?- " },
];

export const TERM_SNIPPET: TerminalLine[] = [
	{ kind: "out", text: "Average: 23.4 °C" },
	{ kind: "out", text: "Max: 25.1" },
];
