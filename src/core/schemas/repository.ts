import { z } from "zod";
import { m } from "@/i18n";
import { buffer, courseId, repositoryId, slug } from "./base";
import { blobHash } from "./blob";
import { courseParams, courseRef } from "./course";

/// How many files one pushed tree may carry.
export const MAX_REPOSITORY_FILES = 2000;

/// The longest path a file of a repository may have, in characters.
export const MAX_REPOSITORY_PATH = 255;

/// Lowercase-hex sha1, as git names objects.
export const gitSha = z
	.string()
	.regex(/^[0-9a-f]{40}$/, m.forms_schema_git_sha_invalid())
	.openapi({ example: "4b825dc642cb6eb9a060e54bf8d69288fbee4904" });
export type GitSha = z.infer<typeof gitSha>;

/// The mode of a file in a tree: a regular file or an executable one.
export const repositoryFileMode = z.enum(["100644", "100755"]);
export type RepositoryFileMode = z.infer<typeof repositoryFileMode>;

/// A file path inside a repository, relative to its root, with `/` separators.
export const repositoryPath = z
	.string()
	.min(1)
	.max(MAX_REPOSITORY_PATH)
	.refine(isRepositoryPath, m.forms_schema_repository_path_invalid())
	.openapi({ example: "src/main.py" });
export type RepositoryPath = z.infer<typeof repositoryPath>;

/// One file of a pushed tree. Directories are implied by the paths.
export const repositoryEntry = z.object({
	path: repositoryPath,
	mode: repositoryFileMode,
	/// Sha-256 of the bytes: the Blob the file points to.
	hash: blobHash,
});
export type RepositoryEntry = z.infer<typeof repositoryEntry>;

export const repositorySchema = z.object({
	id: repositoryId,
	courseId: courseId,
	slug: slug,
	title: z.string().min(1),
	/// Null before the first commit.
	head: gitSha.nullable(),
	/// Sha1 of the head commit's root tree; the CLI compares it to its own.
	tree: gitSha.nullable(),
	/// Message and date of the head commit.
	message: z.string().nullable(),
	committedAt: z.date().nullable(),
	cloneUrl: z.url(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const repositoryCreate = z.object({ course: courseRef, slug: slug });

export const repositoryCommit = z.object({
	tree: z
		.array(repositoryEntry)
		.min(1)
		.max(MAX_REPOSITORY_FILES)
		.superRefine((entries, ctx) => {
			for (const conflict of treeConflicts(entries.map((e) => e.path))) {
				ctx.addIssue({
					code: "custom",
					path: [conflict.index, "path"],
					message: conflict.message,
				});
			}
		}),
	message: z.string().min(1).nullish(),
});

export const repositoryPK = z.union([
	z.object({ id: repositoryId }),
	z.object({ course: courseRef, slug: slug }),
]);

/// Rotates the clone token of the repository `slug` of the course in the URL.
export const repositoryRotate = courseParams.extend({ slug: slug });

export const repositoryFilter = z.object({ course: courseRef });

/// Files sent to a repository before a commit, keyed by the sha-256 of their
/// bytes.
export const repositoryFiles = z.record(blobHash, buffer);

/// What `addFiles` stored: the sha-256 of every file sent, in input order.
export const repositoryFilesResult = z.object({ added: z.array(blobHash) });

/// A directory of the head tree to list, `""` for the root.
export const repositoryDirPath = z.union([z.literal(""), repositoryPath]);

/// One child of a directory of the head tree.
export const repositoryDirEntry = z.object({
	name: z.string().min(1),
	type: z.enum(["file", "dir"]),
	/// `40000` for a directory, as git writes it in a tree.
	mode: z.enum(["100644", "100755", "40000"]),
	/// Bytes of a file; null for a directory.
	size: z.number().int().nonnegative().nullable(),
});

/// A repository a calendar event cites, as the event shows it.
export const repositoryInfo = repositorySchema.pick({
	slug: true,
	title: true,
});

/// The body of `POST /api/blob/missing` and of its answer.
export const blobMissingInput = z.object({
	hashes: z.array(blobHash).max(MAX_REPOSITORY_FILES),
});
export const blobMissingResult = z.object({ missing: z.array(blobHash) });

//
// Tree rules
//

/// Why one path of a tree conflicts with another one.
export type TreeConflict = {
	/// Position of the offending path in the input.
	index: number;
	message: string;
};

/**
 * Whether `path` is a safe relative file path inside a repository.
 *
 * Rejects absolute paths, `\`, NUL, empty segments, `.` and `..`, and a
 * `.git` segment in any letter case. Length is checked by the schema.
 */
export function isRepositoryPath(path: string): boolean {
	if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
		return false;
	}
	return path
		.split("/")
		.every(
			(segment) =>
				segment !== "" &&
				segment !== "." &&
				segment !== ".." &&
				segment.toLowerCase() !== ".git",
		);
}

/**
 * Lists the paths of a tree that cannot coexist with an earlier one.
 *
 * A path conflicts when it repeats an earlier path, differs from one only in
 * letter case, or names a file that is also a directory of another path (in
 * either order). Comparisons ignore case, so a tree checks out the same on a
 * case-insensitive filesystem.
 *
 * @example
 * treeConflicts(["a.txt", "A.txt"]); // [{ index: 1, message: "..." }]
 */
export function treeConflicts(paths: readonly string[]): TreeConflict[] {
	const conflicts: TreeConflict[] = [];
	const files = new Map<string, string>();
	const dirs = new Map<string, string>();

	paths.forEach((path, index) => {
		const key = path.toLowerCase();
		const seen = files.get(key);
		if (seen !== undefined) {
			conflicts.push({
				index,
				message:
					seen === path
						? m.forms_schema_repository_path_duplicate({ path })
						: m.forms_schema_repository_path_case({ path, other: seen }),
			});
			return;
		}

		const asDir = dirs.get(key);
		if (asDir !== undefined) {
			conflicts.push({
				index,
				message: m.forms_schema_repository_path_prefix({ path, other: asDir }),
			});
			return;
		}

		const segments = key.split("/");
		for (let end = 1; end < segments.length; end++) {
			const prefix = segments.slice(0, end).join("/");
			const file = files.get(prefix);
			if (file !== undefined) {
				conflicts.push({
					index,
					message: m.forms_schema_repository_path_prefix({
						path: file,
						other: path,
					}),
				});
				return;
			}
		}

		files.set(key, path);
		for (let end = 1; end < segments.length; end++) {
			const prefix = segments.slice(0, end).join("/");
			if (!dirs.has(prefix)) dirs.set(prefix, path);
		}
	});

	return conflicts;
}
