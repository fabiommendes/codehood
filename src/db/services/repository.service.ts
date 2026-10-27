/**
 * Versioned file trees of a course, served as read-only git repositories and
 * as zips. Writes need `course.update-contents`; reads follow
 * `course.read-contents`, and a repository without a commit exists only for
 * actors who may write the course.
 */
import type { Readable } from "node:stream";
import type { z } from "zod";
import { PUBLIC_URL } from "@/core/constants";
import {
	attachmentSchema,
	blobHash,
	repositoryCommit,
	repositoryCreate,
	repositoryDirEntry,
	repositoryDirPath,
	repositoryFilesResult,
	repositoryFiles as repositoryFilesSchema,
	repositoryFilter,
	repositoryPath,
	repositoryPK,
	repositorySchema,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { Validate } from "@/utils/validate";
import type { PrismaClient, PrismaTx } from "../client";
import { prisma } from "../client";
import type { Attachment, AttachmentService } from "./attachment.service";
import type { BlobService } from "./blob.service";

export type { RepositoryId } from "@/core/schemas";

//
// Type definitions
//
export type Repository = z.infer<typeof repositorySchema>;
export type RepositoryCreate = z.infer<typeof repositoryCreate>;
export type RepositoryCommit = z.infer<typeof repositoryCommit>;
export type RepositoryFilter = z.infer<typeof repositoryFilter>;
export type RepositoryPK = z.infer<typeof repositoryPK>;
export type RepositoryFiles = z.infer<typeof repositoryFilesSchema>;
export type RepositoryFilesResult = z.infer<typeof repositoryFilesResult>;
export type RepositoryDirEntry = z.infer<typeof repositoryDirEntry>;

/// What a clone URL resolves to: enough to serve git objects, nothing to show.
export type RepositoryHandle = {
	id: Repository["id"];
	slug: string;
	/// Null before the first commit; the git routes answer 404 then.
	head: string | null;
};

/** Options a caller may override, injected so tests can pin them. */
export type RepositoryServiceOptions = {
	/// Origin of `cloneUrl`. Defaults to `PUBLIC_URL`.
	publicUrl?: string;
};

export class RepositoryService extends CrudBase<{
	entity: Repository;
	pkFilter: RepositoryPK;
	create: RepositoryCreate;
	filter: RepositoryFilter;
	update: never;
}> {
	protected readonly blob: BlobService;
	protected readonly attachment: AttachmentService;
	protected readonly publicUrl: string;

	constructor(
		blob: BlobService,
		attachment: AttachmentService,
		client: PrismaClient = prisma,
		options: RepositoryServiceOptions = {},
	) {
		super(client);
		this.blob = blob;
		this.attachment = attachment;
		this.publicUrl = options.publicUrl ?? PUBLIC_URL;
	}

	/**
	 * Creates an empty repository (no `head`) with a fresh clone token; its
	 * title is the slug until a commit brings a `README.md`.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} `repository.create` if the actor lacks
	 * `course.update-contents` on the course.
	 * @throws {@link InvalidData} If the course already has a repository with
	 * this slug.
	 */
	@Validate({
		service: true,
		returns: repositorySchema,
		args: [undefined, repositoryCreate],
	})
	protected async createTx(
		_tx: PrismaTx,
		_input: RepositoryCreate,
		_opts: ServiceOptsWithoutTx,
	): Promise<Repository> {
		throw new Error("not implemented");
	}

	/**
	 * Finds a repository by id or by `(course, slug)`, with `tree`, `message`
	 * and `committedAt` read from its head commit.
	 *
	 * Returns `null` if it does not exist, or if it has no commit and the
	 * actor lacks `course.update-contents`.
	 *
	 * @throws {@link NotAllowed} `repository.read` if the actor lacks
	 * `course.read-contents` on its course.
	 */
	@Validate({
		service: true,
		returns: repositorySchema.nullable(),
		args: [undefined, repositoryPK],
	})
	protected async findOneTx(
		_tx: PrismaTx,
		_filter: RepositoryPK,
		_opts: ServiceOptsWithoutTx,
	): Promise<Repository | null> {
		throw new Error("not implemented");
	}

	/**
	 * Lists the repositories of a course, ordered by slug; those without a
	 * commit only for actors with `course.update-contents`.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} `repository.read` if the actor lacks
	 * `course.read-contents` on the course.
	 */
	@Validate({
		service: true,
		returns: repositorySchema.array(),
		args: [undefined, repositoryFilter],
	})
	protected async findManyTx(
		_tx: PrismaTx,
		_filter: RepositoryFilter,
		_opts: ServiceOptsWithoutTx,
	): Promise<Repository[]> {
		throw new Error("not implemented");
	}

	/**
	 * Creates the repository if `(course, slug)` is free, or returns the
	 * existing one unchanged.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} `repository.create` if the actor lacks
	 * `course.update-contents`, whether or not the repository exists.
	 */
	@Validate({
		service: true,
		returns: repositorySchema,
		args: [undefined, repositoryCreate],
	})
	protected async upsertTx(
		_tx: PrismaTx,
		_input: RepositoryCreate,
		_opts: ServiceOptsWithoutTx,
	): Promise<Repository> {
		throw new Error("not implemented");
	}

	/**
	 * Deletes the repository, its git objects and its links to calendar
	 * events, and detaches its attachments so blobs nothing else uses become
	 * collectable. A missing repository is a no-op.
	 *
	 * @throws {@link NotAllowed} `repository.delete` if the actor lacks
	 * `course.update-contents`.
	 */
	@Validate({ service: true, args: [undefined, repositoryPK] })
	protected async deleteTx(
		_tx: PrismaTx,
		_filter: RepositoryPK,
		_opts: ServiceOptsWithoutTx,
	): Promise<void> {
		throw new Error("not implemented");
	}

	/**
	 * Stores the files of a coming commit as blobs (with `gitSha`) and
	 * attaches each to the repository, charged to the actor.
	 *
	 * Each key of `files` must be the sha-256 of its bytes. An attachment the
	 * repository already has for a hash is reused. Until a commit names them,
	 * these attachments are called after their hash.
	 *
	 * @throws {@link NotFound} If the repository does not exist.
	 * @throws {@link NotAllowed} `repository.update` if the actor lacks
	 * `course.update-contents`, or `attachment.create` if the files exceed
	 * the actor's quota.
	 * @throws {@link InvalidData} If a key is not the sha-256 of its bytes,
	 * or a file exceeds `MAX_UPLOAD_BYTES`; nothing is stored then.
	 */
	@Validate({
		service: true,
		returns: repositoryFilesResult,
		args: [repositoryPK, repositoryFilesSchema],
	})
	async addFiles(
		_filter: RepositoryPK,
		_files: RepositoryFiles,
		_opts: ServiceOpts,
	): Promise<RepositoryFilesResult> {
		throw new Error("not implemented");
	}

	/**
	 * Records `input.tree` as the new head, in one transaction.
	 *
	 * Attaches the blobs the tree uses that the server has but the
	 * repository does not, writes the trees and a commit whose parent is the
	 * current head, then updates `head`, `title` (H1 of the root `README.md`,
	 * else the slug) and clears the cached zip. Each blob of the tree ends up
	 * with an attachment named after the basename of its first path. File
	 * attachments no commit of the repository uses are removed.
	 *
	 * Author and committer are the actor's name with `<username@codehood>`,
	 * dated now. The message defaults to `Update YYYY-MM-DD`. A tree equal to
	 * the head's makes no commit and returns the repository as it is.
	 *
	 * @throws {@link NotFound} If the repository does not exist.
	 * @throws {@link NotAllowed} `repository.update` if the actor lacks
	 * `course.update-contents`.
	 * @throws {@link InvalidData} If the tree breaks a path rule, or a `hash`
	 * is neither attached to the repository nor a live blob on the server.
	 */
	@Validate({
		service: true,
		returns: repositorySchema,
		args: [repositoryPK, repositoryCommit],
	})
	async commit(
		_filter: RepositoryPK,
		_input: RepositoryCommit,
		_opts: ServiceOpts,
	): Promise<Repository> {
		throw new Error("not implemented");
	}

	/**
	 * Resolves the token and slug of a clone URL, with no actor: the token is
	 * the credential.
	 *
	 * Returns `null` when the token matches no repository, when it belongs to
	 * a repository with another slug, or when either is malformed.
	 */
	async findByToken(
		_token: string,
		_slug: string,
		_opts: Pick<ServiceOpts, "tx"> = {},
	): Promise<RepositoryHandle | null> {
		throw new Error("not implemented");
	}

	/**
	 * Streams one git object of the repository, header included and not
	 * compressed, so the sha1 of the stream is `sha`.
	 *
	 * Commits and trees come from the repository's stored objects. A blob
	 * comes from disk, looked up by `gitSha` among the repository's own
	 * attachments only; with colliding blobs, any one of them. Returns `null`
	 * for an unknown or malformed sha.
	 */
	async readObject(
		_repository: RepositoryHandle,
		_sha: string,
		_opts: Pick<ServiceOpts, "tx"> = {},
	): Promise<Readable | null> {
		throw new Error("not implemented");
	}

	/**
	 * Lists a directory of the head tree, `""` for the root: directories
	 * first, then files, each group by name.
	 *
	 * Returns `null` when the repository has no head or `path` is not a
	 * directory of it.
	 *
	 * @throws {@link NotAllowed} `repository.read` as `findOne` does.
	 */
	@Validate({
		service: true,
		returns: repositoryDirEntry.array().nullable(),
		args: [repositoryPK, repositoryDirPath],
	})
	async listDir(
		_filter: RepositoryPK,
		_path: string,
		_opts: ServiceOpts,
	): Promise<RepositoryDirEntry[] | null> {
		throw new Error("not implemented");
	}

	/**
	 * The attachment of the file at `path` in the head tree.
	 *
	 * Returns `null` when the repository has no head or `path` is not a file
	 * of it.
	 *
	 * @throws {@link NotAllowed} `repository.read` as `findOne` does.
	 */
	@Validate({
		service: true,
		returns: attachmentSchema.nullable(),
		args: [repositoryPK, repositoryPath],
	})
	async readFile(
		_filter: RepositoryPK,
		_path: string,
		_opts: ServiceOpts,
	): Promise<Attachment | null> {
		throw new Error("not implemented");
	}

	/**
	 * The sha-256 of the zip of the head tree, building it on the first call.
	 *
	 * The archive is written by `writeZip` in streaming to a scratch file,
	 * stored as a blob attached to the repository with no uploader (no quota
	 * charge), and cached in `zipHash` until the next commit. Concurrent
	 * first calls build identical bytes. Returns `null` when the repository
	 * has no head.
	 *
	 * @throws {@link NotAllowed} `repository.read` as `findOne` does.
	 */
	@Validate({
		service: true,
		returns: blobHash.nullable(),
		args: [repositoryPK],
	})
	async zip(_filter: RepositoryPK, _opts: ServiceOpts): Promise<string | null> {
		throw new Error("not implemented");
	}

	/**
	 * Replaces the clone token, so the old clone URL stops resolving.
	 *
	 * @throws {@link NotFound} If the repository does not exist.
	 * @throws {@link NotAllowed} `repository.update` if the actor lacks
	 * `course.update-contents`.
	 */
	@Validate({
		service: true,
		returns: repositorySchema,
		args: [repositoryPK],
	})
	async rotateToken(
		_filter: RepositoryPK,
		_opts: ServiceOpts,
	): Promise<Repository> {
		throw new Error("not implemented");
	}
}
