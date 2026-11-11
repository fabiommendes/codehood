/**
 * Lua driver: Lua 5.4 compiled to WebAssembly (wasmoon).
 *
 * `run` writes the files to `/work/` in the in-memory file system of the
 * runtime and runs the entry file as the chunk `main.lua`, so an error reads
 * `main.lua:3: message`. An unhandled error prints the message and a
 * traceback and exits with code 1; `os.exit(n)` exits with `n`. In `repl`
 * mode each line is evaluated as an expression first, then as a statement.
 * `print`, `io.write`, `io.stderr:write` and `io.read` (formats `l`, `L`, `n`,
 * `a` and a byte count) go through the run's output and `readLine`.
 *
 * Only the standard library is available and no persistent file system is
 * mounted.
 */

import {
	type Driver,
	type LoadContext,
	type RunContext,
	runtimePath,
} from "@codehood/runner-api/driver";
import { RUNTIMES } from "../runtimes";

/// Directory of the program's files in the runtime's file system.
const WORK_DIR = "/work";

/// The Emscripten file system call this driver uses.
interface RuntimeFs {
	chdir(path: string): void;
}

interface LuaEngine {
	global: {
		set(name: string, value: unknown): void;
		get(name: string): unknown;
	};
	doStringSync(script: string): unknown;
}

/// The parts of the wasmoon API this driver uses.
interface WasmoonModule {
	LuaFactory: new (
		wasmUri: string,
	) => {
		/// Writes a file, creating its directories.
		mountFile(path: string, content: string): Promise<void>;
		getLuaModule(): Promise<{ module: { FS: RuntimeFs } }>;
		createEngine(): Promise<LuaEngine>;
	};
}

/// What the `load` and `run` of one Worker share.
interface Loaded {
	engine: LuaEngine;
	mountFile(path: string, content: string): Promise<void>;
	fs: RuntimeFs;
	/// The `RunContext` of the current run, read by the I/O callbacks.
	ctx: RunContext | null;
}

let loaded: Loaded | null = null;

/// Lua side of the driver. Receives the three JS callbacks, replaces the
/// functions that talk to the terminal and returns `run(name, source,
/// interactive)`, which gives the exit code.
const BOOTSTRAP = `
local out, err, readline = ...

local function tostr(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
  return table.concat(parts, "\\t")
end

print = function(...) out(tostr(...) .. "\\n") end

local function writer(emit)
  return function(self, ...)
    for i = 1, select("#", ...) do
      local v = select(i, ...)
      local t = type(v)
      if t ~= "string" and t ~= "number" then
        error("bad argument #" .. i .. " to 'write' (string expected, got " .. t .. ")", 2)
      end
      emit(tostring(v))
    end
    return self
  end
end

local buffer = ""
local at_eof = false

-- Makes sure the buffer is not empty; false at end of input.
local function fill()
  while buffer == "" do
    if at_eof then return false end
    local line = readline()
    if line == nil then at_eof = true return false end
    buffer = line .. "\\n"
  end
  return true
end

local function take(n)
  local s = buffer:sub(1, n)
  buffer = buffer:sub(n + 1)
  return s
end

local NUMBER = {
  "^[+-]?0[xX]%x+",
  "^[+-]?%d+%.?%d*[eE][+-]?%d+",
  "^[+-]?%.%d+[eE][+-]?%d+",
  "^[+-]?%d+%.%d*",
  "^[+-]?%.%d+",
  "^[+-]?%d+",
}

local function read_number()
  while true do
    if not fill() then return nil end
    local blank = buffer:match("^%s+")
    if not blank then break end
    take(#blank)
  end
  for _, pattern in ipairs(NUMBER) do
    local text = buffer:match(pattern)
    if text then
      take(#text)
      return tonumber(text)
    end
  end
  return nil
end

local function read_one(format)
  if type(format) == "number" then
    if format == 0 then return fill() and "" or nil end
    local parts, left = {}, format
    while left > 0 and fill() do
      local s = take(left)
      parts[#parts + 1] = s
      left = left - #s
    end
    if #parts == 0 then return nil end
    return table.concat(parts)
  end
  local f = tostring(format):gsub("^%*", ""):sub(1, 1)
  if f == "l" or f == "L" then
    if not fill() then return nil end
    local line = take(buffer:find("\\n", 1, true))
    if f == "l" then line = line:sub(1, -2) end
    return line
  elseif f == "n" then
    return read_number()
  elseif f == "a" then
    local parts = {}
    while fill() do parts[#parts + 1] = take(#buffer) end
    return table.concat(parts)
  end
  error("bad argument #1 to 'read' (invalid format)", 3)
end

local function read(self, ...)
  local n = select("#", ...)
  if n == 0 then return read_one("l") end
  local results = {}
  for i = 1, n do
    local value = read_one((select(i, ...)))
    results[i] = value
    if value == nil then return table.unpack(results, 1, i) end
  end
  return table.unpack(results, 1, n)
end

local function lines(self, ...)
  local formats = table.pack(...)
  return function()
    if formats.n == 0 then return read_one("l") end
    return read(self, table.unpack(formats, 1, formats.n))
  end
end

local function stream(fields)
  fields.flush = function(self) return self end
  fields.close = function(self) return true end
  fields.setvbuf = function() return true end
  return setmetatable(fields, { __tostring = function() return "file (0x0)" end, __name = "FILE*" })
end

local stdout = stream({ write = writer(out) })
local stderr = stream({ write = writer(err) })
local stdin = stream({ read = read, lines = lines })

io.stdout, io.stderr, io.stdin = stdout, stderr, stdin
io.write = function(...) return stdout:write(...) end
io.read = function(...) return stdin:read(...) end
local file_lines = io.lines
io.lines = function(name, ...)
  if name == nil then return stdin:lines(...) end
  return file_lines(name, ...)
end
io.output = function() return stdout end
io.input = function() return stdin end

local EXIT = {}

os.exit = function(code)
  if code == nil or code == true then code = 0 elseif code == false then code = 1 end
  error(setmetatable({ code = math.tointeger(code) or 1 }, EXIT), 0)
end

local function handler(e)
  if getmetatable(e) == EXIT then return e end
  if type(e) ~= "string" then
    e = "(error object is a " .. type(e) .. " value)"
  end
  return debug.traceback(e, 2)
end

local function finish(ok, e)
  if ok then return 0 end
  if getmetatable(e) == EXIT then return e.code end
  err("lua: " .. e .. "\\n")
  return 1
end

local function repl()
  local pending = ""
  while true do
    local line = readline()
    if line == nil then break end
    local source = pending .. line
    local fn, message = load("return " .. source, "=stdin")
    if not fn then fn, message = load(source, "=stdin") end
    if not fn and message:sub(-5) == "<eof>" then
      pending = source .. "\\n"
    else
      pending = ""
      if not fn then
        err(message .. "\\n")
      else
        local result = table.pack(xpcall(fn, handler))
        if result[1] then
          if result.n > 1 then out(tostr(table.unpack(result, 2, result.n)) .. "\\n") end
        elseif getmetatable(result[2]) == EXIT then
          return result[2].code
        else
          err(result[2] .. "\\n")
        end
      end
    end
  end
  return 0
end

return function(name, source, interactive)
  local fn, message = load(source, "@" .. name)
  if not fn then
    err("lua: " .. message .. "\\n")
    return 1
  end
  local code = finish(xpcall(fn, handler))
  if interactive and code == 0 then return repl() end
  return code
end
`;

export const luaDriver: Driver = {
	language: "lua",
	modes: ["script", "repl"],

	async load(ctx: LoadContext) {
		const url = (file: string) =>
			ctx.runtimeUrl(runtimePath(RUNTIMES.wasmoon, file));
		const { default: wasmoon } = (await import(
			/* @vite-ignore */ url("wasmoon.js")
		)) as { default: WasmoonModule };
		const factory = new wasmoon.LuaFactory(url("glue.wasm"));
		const state: Loaded = {
			engine: await factory.createEngine(),
			mountFile: (path, content) => factory.mountFile(path, content),
			fs: (await factory.getLuaModule()).module.FS,
			ctx: null,
		};
		const { global } = state.engine;
		global.set("__codehood_out", (text: string) => state.ctx?.stdout(text));
		global.set("__codehood_err", (text: string) => state.ctx?.stderr(text));
		global.set("__codehood_readline", () => state.ctx?.readLine() ?? undefined);
		global.set("__codehood_bootstrap", BOOTSTRAP);
		state.engine.doStringSync(
			`local fn = assert(load(__codehood_bootstrap, "=codehood"))
			__codehood_run = fn(__codehood_out, __codehood_err, __codehood_readline)
			__codehood_out, __codehood_err, __codehood_readline, __codehood_bootstrap = nil`,
		);
		loaded = state;
	},

	async run(ctx: RunContext) {
		if (!loaded) throw new Error("The Lua runtime was not loaded.");
		const { engine, fs, mountFile } = loaded;
		loaded.ctx = ctx;
		for (const [path, text] of Object.entries(ctx.files)) {
			await mountFile(`${WORK_DIR}/${path}`, text);
		}
		fs.chdir(WORK_DIR);
		const run = engine.global.get("__codehood_run") as (
			...args: unknown[]
		) => unknown;
		const status = run(
			ctx.entry,
			ctx.files[ctx.entry] ?? "",
			ctx.mode === "repl",
		);
		return typeof status === "number" ? status : 0;
	},
};

export default luaDriver;
