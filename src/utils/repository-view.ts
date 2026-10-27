/**
 * How the repository browser shows a file of the head tree: as markdown, as
 * highlighted code, as an inline image, or as a plain download link.
 */

/// The largest text file the browser reads and renders, in bytes.
export const MAX_RENDERED_BYTES = 1024 * 1024;

/// File extension to the language `highlightCode` knows it by. Mirrors
/// `CODE_LANGUAGES` of the CLI (`cli/codehood/push/resource.py`).
export const CODE_LANGUAGES: Readonly<Record<string, string>> = {
	".py": "python",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "javascript",
	".ts": "typescript",
	".tsx": "typescript",
	".java": "java",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".hpp": "cpp",
	".cs": "csharp",
	".go": "go",
	".rs": "rust",
	".rb": "ruby",
	".php": "php",
	".sh": "bash",
	".bash": "bash",
	".sql": "sql",
	".html": "html",
	".css": "css",
	".json": "json",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".kt": "kotlin",
	".swift": "swift",
	".scala": "scala",
	".r": "r",
	".pl": "perl",
	".lua": "lua",
	".hs": "haskell",
};

/// Extensions of text files with no highlighting grammar worth picking.
const PLAIN_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
	".txt",
	".csv",
	".log",
	".ini",
	".cfg",
	".xml",
	".tex",
]);

/// Extensions a browser shows inline in an `<img>`.
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".webp",
	".avif",
	".svg",
]);

/// What the browser does with a file.
export type FileView =
	| { kind: "markdown" }
	| { kind: "code"; language: string }
	| { kind: "image" }
	| { kind: "download" };

/// Lowercased extension of the last segment of `path`, with its dot, or "".
function extensionOf(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Decides how to show the file at `path`.
 *
 * Text (markdown, code, plain) larger than {@link MAX_RENDERED_BYTES} is only
 * offered as a download.
 *
 * @example fileView("calc/ops.py", 120)
 * //=> { kind: "code", language: "python" }
 */
export function fileView(path: string, size: number): FileView {
	const ext = extensionOf(path);
	if (IMAGE_EXTENSIONS.has(ext)) return { kind: "image" };
	if (size > MAX_RENDERED_BYTES) return { kind: "download" };
	if (ext === ".md" || ext === ".markdown") return { kind: "markdown" };
	const language = CODE_LANGUAGES[ext];
	if (language) return { kind: "code", language };
	if (PLAIN_TEXT_EXTENSIONS.has(ext)) return { kind: "code", language: "text" };
	return { kind: "download" };
}
