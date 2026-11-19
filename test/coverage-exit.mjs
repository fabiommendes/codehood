// Preloaded into the server under test when coverage is on: Node writes the
// V8 coverage of a process only when it exits by itself, and Playwright stops
// its web servers with SIGTERM.
for (const signal of ["SIGTERM", "SIGINT"]) {
	process.on(signal, () => process.exit(0));
}
