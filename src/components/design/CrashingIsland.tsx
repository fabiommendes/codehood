/**
 * An island whose render throws, so a page can show what a crash in one
 * looks like.
 */
export default function CrashingIsland() {
	throw new Error("CrashingIsland always throws while rendering");
}
