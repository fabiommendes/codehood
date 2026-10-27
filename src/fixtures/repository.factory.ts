import { Factory } from "fishery";
import type { RepositoryEntry, RepositoryFileMode } from "@/core/schemas";
import {
	db,
	type Repository,
	type RepositoryCreate,
	type RepositoryFiles,
	type schema,
} from "@/db";
import { hashBytes } from "@/utils/content-hash";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

function buildRepository(
	sequence: number,
	params: Partial<RepositoryCreate>,
): RepositoryCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		slug: params.slug ?? `repository-${sequence}`,
	};
}

/** Builds `RepositoryCreate` payloads, ready for `repositoryService.create`. */
export const repositoryFactory = Factory.define<
	RepositoryCreate,
	unknown,
	RepositoryCreate,
	Partial<RepositoryCreate>
>(({ sequence, params }) => buildRepository(sequence, params));

/**
 * Builds a `RepositoryCreate` payload and persists it via
 * `repositoryService.create`, as an empty repository (no commit).
 *
 * `course` is provisioned automatically (a fresh course) when left unset.
 */
export const persistedRepositoryFactory = Factory.define<
	RepositoryCreate,
	PersistParams,
	Repository,
	Partial<RepositoryCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const course =
			params.course ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		return db.repository.create({ ...input, course }, opts);
	});

	return buildRepository(sequence, params);
});

/// The contents of one file of a test tree: its text or bytes, optionally
/// executable.
export type TreeFileSpec =
	| string
	| Buffer
	| { content: string | Buffer; mode: RepositoryFileMode };

/**
 * Turns `{ path: content }` into the two halves of a push: the files for
 * `addFiles`, keyed by sha-256, and the tree for `commit`.
 *
 * @example
 * const { files, tree } = repositoryTree({ "README.md": "# Lab\n" });
 * await db.repository.addFiles(pk, files, opts);
 * await db.repository.commit(pk, { tree }, opts);
 */
export function repositoryTree(spec: Record<string, TreeFileSpec>): {
	files: RepositoryFiles;
	tree: RepositoryEntry[];
} {
	const files: RepositoryFiles = {};
	const tree: RepositoryEntry[] = [];
	for (const [path, value] of Object.entries(spec)) {
		const { content, mode } =
			typeof value === "string" || Buffer.isBuffer(value)
				? { content: value, mode: "100644" as const }
				: value;
		const bytes = Buffer.isBuffer(content)
			? content
			: Buffer.from(content, "utf-8");
		const hash = hashBytes(bytes);
		files[hash] = bytes;
		tree.push({ path, mode, hash });
	}
	return { files, tree };
}
