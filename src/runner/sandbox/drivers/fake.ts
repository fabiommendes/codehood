/**
 * Deterministic driver for tests: a tiny command language that exercises
 * every path of the protocol without downloading a runtime.
 *
 * The entry file has one command per line; blank lines are skipped:
 *
 * | Command                   | Effect                                              |
 * | :------------------------ | :-------------------------------------------------- |
 * | `out <text>`              | writes `<text>\n` to stdout                         |
 * | `err <text>`              | writes `<text>\n` to stderr                         |
 * | `read`                    | `readLine()`; writes `<line>\n`, or `EOF\n` on null |
 * | `flood <bytes>`           | writes `<bytes>` characters `x` to stdout           |
 * | `loop`                    | spins forever (`while (true) {}`)                   |
 * | `exit <code>`             | ends with that exit code                            |
 * | `crash <message>`         | throws; the run ends with `crashed`                 |
 *
 * `load` honors the commands that appear before any other command:
 *
 * | Command                   | Effect                                              |
 * | :------------------------ | :-------------------------------------------------- |
 * | `progress <loaded> <total>` | reports download progress                         |
 * | `load-delay <ms>`         | waits before finishing the load                     |
 * | `load-fail <message>`     | throws; the run ends with `load-failed`             |
 *
 * Without `exit`, the program ends with code 0. REPL mode reads lines and runs
 * each as a command until end of input.
 */

import type {
	Driver,
	LoadContext,
	RunContext,
} from "@codehood/runner-api/driver";

/// Commands that configure the load; `run` skips them while they lead the file.
const LOAD_COMMANDS = new Set(["progress", "load-delay", "load-fail"]);

/// Size of each write of `flood`.
const FLOOD_CHUNK = 64 * 1024;

/// One non-blank line split into its command and the rest of the line.
function parseLine(line: string): { name: string; arg: string } | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	const space = trimmed.indexOf(" ");
	return space < 0
		? { name: trimmed, arg: "" }
		: { name: trimmed.slice(0, space), arg: trimmed.slice(space + 1) };
}

function commandsOf(source: string) {
	return source.split("\n").flatMap((line) => parseLine(line) ?? []);
}

function sourceOf(files: Readonly<Record<string, string>>, entry: string) {
	return files[entry] ?? "";
}

/// Executes one command; returns an exit code when the command ends the program.
function execute(
	ctx: RunContext,
	command: { name: string; arg: string },
): number | undefined {
	const { name, arg } = command;
	switch (name) {
		case "out":
			ctx.stdout(`${arg}\n`);
			return;
		case "err":
			ctx.stderr(`${arg}\n`);
			return;
		case "read": {
			const line = ctx.readLine();
			ctx.stdout(line === null ? "EOF\n" : `${line}\n`);
			return;
		}
		case "flood": {
			for (let left = Number(arg); left > 0; left -= FLOOD_CHUNK) {
				ctx.stdout("x".repeat(Math.min(left, FLOOD_CHUNK)));
			}
			return;
		}
		case "loop":
			for (;;) {
				// Spins until the frame terminates the Worker.
			}
		case "exit":
			return Number(arg) | 0;
		case "crash":
			throw new Error(arg);
		default:
			throw new Error(`unknown command: ${name}`);
	}
}

export const fakeDriver: Driver = {
	language: "fake",
	modes: ["script", "repl"],
	async load(ctx: LoadContext) {
		if (!ctx.program) return;
		for (const { name, arg } of commandsOf(
			sourceOf(ctx.program.files, ctx.program.entry),
		)) {
			if (!LOAD_COMMANDS.has(name)) return;
			if (name === "progress") {
				const [loaded = "0", total = "0"] = arg.split(/\s+/);
				ctx.progress(Number(loaded), Number(total));
			} else if (name === "load-delay") {
				await new Promise((resolve) => setTimeout(resolve, Number(arg)));
			} else {
				throw new Error(arg);
			}
		}
	},
	async run(ctx: RunContext) {
		if (ctx.mode === "repl") {
			for (let line = ctx.readLine(); line !== null; line = ctx.readLine()) {
				const command = parseLine(line);
				const code = command ? execute(ctx, command) : undefined;
				if (code !== undefined) return code;
			}
			return 0;
		}
		let leading = true;
		for (const command of commandsOf(sourceOf(ctx.files, ctx.entry))) {
			if (leading && LOAD_COMMANDS.has(command.name)) continue;
			leading = false;
			const code = execute(ctx, command);
			if (code !== undefined) return code;
		}
		return 0;
	},
};
