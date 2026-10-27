/**
 * Versioned file trees of a course, served as read-only git repositories and
 * as zips. Writes need `course.update-contents`; reads follow
 * `course.read-contents`, and a repository without a commit exists only for
 * actors who may write the course.
 */
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { PUBLIC_URL } from "@/core/constants";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import {
	type AttachmentId,
	attachmentSchema,
	blobHash,
	type CourseId,
	MAX_UPLOAD_BYTES,
	type RepositoryId,
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
import { m } from "@/i18n";
import {
	blobSha,
	buildTrees,
	type GitFileEntry,
	type GitTreeEntry,
	objectSha,
	objectStream,
	parseCommit,
	parseTree,
	serializeCommit,
} from "@/services/git/objects";
import { writeZip, type ZipFile } from "@/services/git/zip";
import { hashBytes } from "@/utils/content-hash";
import { sanitizeFilename } from "@/utils/filename";
import { mimeFor } from "@/utils/mime";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaClient, PrismaTx } from "../client";
import { prisma } from "../client";
import { courseRefMatch, courseRefWhere, valueOrNotFound } from "../utils";
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
		tx: PrismaTx,
		input: RepositoryCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Repository> {
		const course = await this.courseOf(tx, input.course);
		if (!hasPerm(opts.actor, "course.update-contents", course)) {
			throw new NotAllowed("repository.create");
		}
		return this.insert(tx, course.id, input.slug);
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
		tx: PrismaTx,
		filter: RepositoryPK,
		opts: ServiceOptsWithoutTx,
	): Promise<Repository | null> {
		const row = await tx.repository.findFirst({
			where: repositoryWhere(filter),
			include: REPOSITORY_INCLUDE,
		});
		if (!row) return null;
		if (!this.visible(row, opts.actor)) return null;
		return this.toRepository(tx, row);
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
		tx: PrismaTx,
		filter: RepositoryFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<Repository[]> {
		const course = await this.courseOf(tx, filter.course);
		if (!hasPerm(opts.actor, "course.read-contents", course)) {
			throw new NotAllowed("repository.read");
		}
		const canWrite = hasPerm(opts.actor, "course.update-contents", course);
		const rows = await tx.repository.findMany({
			where: {
				courseId: course.id,
				...(canWrite ? {} : { head: { not: null } }),
			},
			include: REPOSITORY_INCLUDE,
			orderBy: { slug: "asc" },
		});
		return this.toRepositories(tx, rows);
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
		tx: PrismaTx,
		input: RepositoryCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<Repository> {
		const course = await this.courseOf(tx, input.course);
		if (!hasPerm(opts.actor, "course.update-contents", course)) {
			throw new NotAllowed("repository.create");
		}
		const existing = await tx.repository.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: input.slug } },
			include: REPOSITORY_INCLUDE,
		});
		if (existing) return this.toRepository(tx, existing);
		return this.insert(tx, course.id, input.slug);
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
		tx: PrismaTx,
		filter: RepositoryPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const row = await tx.repository.findFirst({
			where: repositoryWhere(filter),
			include: REPOSITORY_INCLUDE,
		});
		if (!row) return;
		if (!hasPerm(opts.actor, "course.update-contents", row.course)) {
			throw new NotAllowed("repository.delete");
		}
		await this.attachment.detach("REPOSITORY", row.id, { ...opts, tx });
		await tx.repository.delete({ where: { id: row.id } });
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
		filter: RepositoryPK,
		files: RepositoryFiles,
		opts: ServiceOpts,
	): Promise<RepositoryFilesResult> {
		return this.$transaction(opts, async (tx, scoped) => {
			const row = await this.writable(
				tx,
				filter,
				opts.actor,
				"repository.update",
			);
			const hashes = Object.keys(files);
			for (const hash of hashes) {
				const bytes = files[hash as keyof typeof files] as Buffer;
				if (bytes.length > MAX_UPLOAD_BYTES) {
					throw new InvalidData({
						[hash]: [
							{
								code: "too-long",
								message: m.errors_repository_file_too_large({
									hash,
									max: MAX_UPLOAD_BYTES,
								}),
							},
						],
					});
				}
				if (hashBytes(bytes) !== hash) {
					throw new InvalidData({
						[hash]: [
							{
								code: "invalid",
								message: m.errors_repository_file_hash_mismatch({ hash }),
							},
						],
					});
				}
			}

			for (const hash of hashes) {
				const attached = await tx.attachment.findFirst({
					where: { hash, ...ownedBy(row.id) },
					select: { id: true },
				});
				if (attached) continue;
				await this.attachment.create(
					{
						filename: placeholderName(hash),
						buffer: files[hash as keyof typeof files] as Buffer,
						attachedTo: { type: "REPOSITORY", id: row.id as RepositoryId },
					},
					{ ...scoped, tx },
				);
			}
			return { added: hashes };
		});
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
		filter: RepositoryPK,
		input: RepositoryCommit,
		opts: ServiceOpts,
	): Promise<Repository> {
		return this.$transaction(opts, async (tx, scoped) => {
			const row = await this.writable(
				tx,
				filter,
				opts.actor,
				"repository.update",
			);
			const inner = { ...scoped, tx };
			const owner = { type: "REPOSITORY", id: row.id as RepositoryId } as const;

			// R7: every hash is a blob of this repository or a live blob of the server.
			const hashes = [...new Set(input.tree.map((e) => e.hash))];
			const attached = await tx.attachment.findMany({
				where: { hash: { in: hashes }, ...ownedBy(row.id) },
			});
			const attachedHashes = new Set(attached.map((a) => a.hash));
			const blobs = new Map(
				(await tx.blob.findMany({ where: { hash: { in: hashes } } })).map(
					(b) => [b.hash, b],
				),
			);
			input.tree.forEach((entry, index) => {
				const blob = blobs.get(entry.hash);
				if (!attachedHashes.has(entry.hash) && (!blob || blob.deletedAt)) {
					throw new InvalidData({
						[`tree.${index}.hash`]: [
							{
								code: "not-exists",
								message: m.errors_repository_hash_unknown({ hash: entry.hash }),
							},
						],
					});
				}
			});

			// Git shas of the blobs, filling those stored before they were computed.
			const gitShas = new Map<string, string>();
			for (const blob of blobs.values()) {
				let gitSha = blob.gitSha;
				if (!gitSha) {
					const bytes = await this.blob.readBlob(blob);
					if (!bytes) {
						throw new InvalidData({
							tree: [
								{
									code: "not-exists",
									message: m.errors_repository_hash_unknown({
										hash: blob.hash,
									}),
								},
							],
						});
					}
					gitSha = blobSha(bytes);
					await tx.blob.update({
						where: { hash: blob.hash },
						data: { gitSha },
					});
				}
				gitShas.set(blob.hash, gitSha);
			}

			const files: GitFileEntry[] = input.tree.map((entry) => ({
				path: entry.path,
				mode: entry.mode,
				gitSha: gitShas.get(entry.hash) as string,
			}));
			const trees = buildTrees(files);

			const headCommit = row.head
				? await this.commitOf(tx, row.id, row.head)
				: null;
			if (headCommit && headCommit.tree === trees.root) {
				return this.toRepository(tx, row);
			}

			// Attach what the server already had, named after the first path.
			const firstPath = new Map<string, string>();
			for (const entry of input.tree) {
				if (!firstPath.has(entry.hash)) firstPath.set(entry.hash, entry.path);
			}
			for (const hash of hashes) {
				if (attachedHashes.has(hash)) continue;
				await this.attachment.attach(
					{
						hash,
						filename:
							attachmentName(firstPath.get(hash) as string) ??
							placeholderName(hash),
						attachedTo: owner,
					},
					inner,
				);
			}
			for (const att of attached) {
				if (att.filename !== placeholderName(att.hash)) continue;
				const name = attachmentName(firstPath.get(att.hash) as string);
				if (name) await this.rename(tx, att, name);
			}

			// Git objects.
			const known = new Set(
				(
					await tx.gitObject.findMany({
						where: { repositoryId: row.id },
						select: { sha: true },
					})
				).map((o) => o.sha),
			);
			const author = signatureOf(opts.actor, new Date());
			const body = serializeCommit({
				tree: trees.root,
				parents: row.head ? [row.head] : [],
				author,
				committer: author,
				message: commitMessage(input.message, author.date),
			});
			const commitSha = objectSha("commit", body);
			const objects = [
				...trees.trees.map((t) => ({
					sha: t.sha,
					type: "TREE" as const,
					content: t.body,
				})),
				{ sha: commitSha, type: "COMMIT" as const, content: body },
			].filter((o) => !known.has(o.sha));
			await tx.gitObject.createMany({
				data: objects.map((o) => ({
					repositoryId: row.id,
					sha: o.sha,
					type: o.type,
					content: new Uint8Array(o.content),
				})),
			});

			// The cached zip belongs to the old tree.
			if (row.zipHash) await this.releaseHash(tx, row.id, row.zipHash, inner);

			await this.dropAbandoned(tx, row.id, inner);

			const updated = await tx.repository.update({
				where: { id: row.id },
				data: {
					head: commitSha,
					title: await this.titleOf(input.tree, row.slug),
					zipHash: null,
				},
				include: REPOSITORY_INCLUDE,
			});
			return this.toRepository(tx, updated);
		});
	}

	/**
	 * Resolves the token and slug of a clone URL, with no actor: the token is
	 * the credential.
	 *
	 * Returns `null` when the token matches no repository, when it belongs to
	 * a repository with another slug, or when either is malformed.
	 */
	async findByToken(
		token: string,
		slug: string,
		opts: Pick<ServiceOpts, "tx"> = {},
	): Promise<RepositoryHandle | null> {
		if (!TOKEN_PATTERN.test(token) || !slug) return null;
		const client = opts.tx ?? this.prisma;
		const row = await client.repository.findUnique({
			where: { token },
			select: { id: true, slug: true, head: true },
		});
		if (!row || row.slug !== slug) return null;
		return { id: row.id as RepositoryId, slug: row.slug, head: row.head };
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
		repository: RepositoryHandle,
		sha: string,
		opts: Pick<ServiceOpts, "tx"> = {},
	): Promise<Readable | null> {
		if (!GIT_SHA_PATTERN.test(sha)) return null;
		const client = opts.tx ?? this.prisma;
		const object = await client.gitObject.findUnique({
			where: { repositoryId_sha: { repositoryId: repository.id, sha } },
		});
		if (object) {
			const content = Buffer.from(object.content);
			return objectStream(
				object.type === "COMMIT" ? "commit" : "tree",
				content.length,
				content,
			);
		}

		const attachment = await client.attachment.findFirst({
			where: {
				...ownedBy(repository.id),
				blob: { gitSha: sha, deletedAt: null },
			},
			include: { blob: { select: { hash: true, size: true } } },
		});
		if (!attachment) return null;
		const file = this.blob.blobPath(attachment.blob.hash);
		if (!(await stat(file).catch(() => null))) return null;
		return objectStream("blob", attachment.blob.size, createReadStream(file));
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
		filter: RepositoryPK,
		path: string,
		opts: ServiceOpts,
	): Promise<RepositoryDirEntry[] | null> {
		return this.$transaction(opts, async (tx) => {
			const row = await this.readable(tx, filter, opts.actor);
			if (!row?.head) return null;
			const commit = await this.commitOf(tx, row.id, row.head);
			const segments = path === "" ? [] : path.split("/");
			const entries = await this.dirAt(tx, row.id, commit.tree, segments);
			if (!entries) return null;

			const shas = entries.filter((e) => e.mode !== "40000").map((e) => e.sha);
			const sizes = new Map(
				(
					await tx.blob.findMany({
						where: {
							gitSha: { in: shas },
							attachments: { some: ownedBy(row.id) },
						},
						select: { gitSha: true, size: true },
					})
				).map((b) => [b.gitSha, b.size]),
			);
			return entries
				.map((e): RepositoryDirEntry => {
					const dir = e.mode === "40000";
					return {
						name: e.name,
						type: dir ? "dir" : "file",
						mode: e.mode,
						size: dir ? null : (sizes.get(e.sha) ?? 0),
					};
				})
				.sort(
					(a, b) =>
						Number(a.type === "file") - Number(b.type === "file") ||
						(a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
				);
		});
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
		filter: RepositoryPK,
		path: string,
		opts: ServiceOpts,
	): Promise<Attachment | null> {
		return this.$transaction(opts, async (tx, scoped) => {
			const row = await this.readable(tx, filter, opts.actor);
			if (!row?.head) return null;
			const commit = await this.commitOf(tx, row.id, row.head);
			const segments = path.split("/");
			const name = segments.pop() as string;
			const entries = await this.dirAt(tx, row.id, commit.tree, segments);
			const entry = entries?.find((e) => e.name === name && e.mode !== "40000");
			if (!entry) return null;

			const attachment = await tx.attachment.findFirst({
				where: {
					...ownedBy(row.id),
					blob: { gitSha: entry.sha, deletedAt: null },
				},
				select: { id: true },
			});
			if (!attachment) return null;
			return this.attachment.findOne({ id: attachment.id }, { ...scoped, tx });
		});
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
	async zip(filter: RepositoryPK, opts: ServiceOpts): Promise<string | null> {
		const client = opts.tx ?? this.prisma;
		const plan = await this.$transaction(opts, async (tx) => {
			const row = await this.readable(tx, filter, opts.actor);
			if (!row?.head) return null;
			if (row.zipHash) {
				const cached = await tx.attachment.findFirst({
					where: { hash: row.zipHash, ...ownedBy(row.id) },
					select: { id: true },
				});
				if (cached) return { kind: "cached", hash: row.zipHash } as const;
			}

			const commit = await this.commitOf(tx, row.id, row.head);
			const flat = await this.flatten(tx, row.id, commit.tree, "");
			const blobs = new Map(
				(
					await tx.blob.findMany({
						where: {
							gitSha: { in: flat.map((f) => f.sha) },
							deletedAt: null,
							attachments: { some: ownedBy(row.id) },
						},
						select: { hash: true, size: true, gitSha: true },
					})
				).map((b) => [b.gitSha, b]),
			);
			const files: ZipFile[] = flat.map((f) => {
				const blob = blobs.get(f.sha);
				if (!blob) throw new Error(`blob ${f.sha} of ${f.path} is missing`);
				const file = this.blob.blobPath(blob.hash);
				return {
					path: f.path,
					mode: f.mode,
					size: blob.size,
					open: () => createReadStream(file),
				};
			});
			return {
				kind: "build",
				id: row.id,
				slug: row.slug,
				head: row.head,
				date: commit.committer.date,
				files,
			} as const;
		});
		if (!plan) return null;
		if (plan.kind === "cached") return plan.hash;

		const scratch = await this.blob.tempPath();
		try {
			await pipeline(
				writeZip(plan.files, { root: plan.slug, date: plan.date }),
				createWriteStream(scratch),
			);
			return await this.$transaction(opts, async (tx) => {
				const system: ServiceOpts = { actor: SYSTEM, tx };
				const blob = await this.blob.createFromFile(scratch, system);
				const current = await tx.repository.findUnique({
					where: { id: plan.id },
					select: { head: true },
				});
				// A commit that landed meanwhile makes this archive stale: serve it
				// once, but do not cache it.
				if (current?.head === plan.head) {
					await this.attachment.attach(
						{
							hash: blob.hash,
							filename: `${plan.slug}.zip`,
							attachedTo: { type: "REPOSITORY", id: plan.id as RepositoryId },
						},
						system,
					);
					await tx.repository.update({
						where: { id: plan.id },
						data: { zipHash: blob.hash },
					});
				}
				return blob.hash;
			});
		} catch (error) {
			// A concurrent first call may have stored the same archive already.
			const fresh = await client.repository.findUnique({
				where: { id: plan.id },
				select: { zipHash: true },
			});
			if (fresh?.zipHash) return fresh.zipHash;
			throw error;
		} finally {
			await rm(scratch, { force: true });
		}
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
		filter: RepositoryPK,
		opts: ServiceOpts,
	): Promise<Repository> {
		return this.$transaction(opts, async (tx) => {
			const row = await this.writable(
				tx,
				filter,
				opts.actor,
				"repository.update",
			);
			const updated = await tx.repository.update({
				where: { id: row.id },
				data: { token: newToken() },
				include: REPOSITORY_INCLUDE,
			});
			return this.toRepository(tx, updated);
		});
	}

	// Private utilities ------------------------------------------------------

	/// The course of `ref` with what the course permissions read.
	private async courseOf(tx: PrismaTx, ref: RepositoryCreate["course"]) {
		return valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(ref),
				select: COURSE_SELECT,
			}),
		);
	}

	/// Inserts a repository with a fresh token, refusing a taken slug.
	private async insert(
		tx: PrismaTx,
		courseId: CourseId,
		slug: string,
	): Promise<Repository> {
		const taken = await tx.repository.findUnique({
			where: { courseId_slug: { courseId, slug } },
			select: { id: true },
		});
		if (taken) {
			throw new InvalidData({
				slug: [{ code: "not-unique", message: m.errors_repository_exists() }],
			});
		}
		const row = await tx.repository.create({
			data: { courseId, slug, title: slug, token: newToken() },
			include: REPOSITORY_INCLUDE,
		});
		return this.toRepository(tx, row);
	}

	/// Whether `actor` sees `row`: it may not read the course (throws), or the
	/// repository has no commit and the actor cannot write the course (false).
	private visible(row: DbRepository, actor: Actor): boolean {
		if (!hasPerm(actor, "course.read-contents", row.course)) {
			throw new NotAllowed("repository.read");
		}
		return (
			row.head !== null || hasPerm(actor, "course.update-contents", row.course)
		);
	}

	private async readable(
		tx: PrismaTx,
		filter: RepositoryPK,
		actor: Actor,
	): Promise<DbRepository | null> {
		const row = await tx.repository.findFirst({
			where: repositoryWhere(filter),
			include: REPOSITORY_INCLUDE,
		});
		return row && this.visible(row, actor) ? row : null;
	}

	private async writable(
		tx: PrismaTx,
		filter: RepositoryPK,
		actor: Actor,
		action: "repository.update",
	): Promise<DbRepository> {
		const row = valueOrNotFound(
			"repository",
			await tx.repository.findFirst({
				where: repositoryWhere(filter),
				include: REPOSITORY_INCLUDE,
			}),
		);
		if (!hasPerm(actor, "course.update-contents", row.course)) {
			throw new NotAllowed(action);
		}
		return row;
	}

	private async toRepository(
		tx: PrismaTx,
		row: DbRepository,
	): Promise<Repository> {
		return (await this.toRepositories(tx, [row]))[0] as Repository;
	}

	private async toRepositories(
		tx: PrismaTx,
		rows: DbRepository[],
	): Promise<Repository[]> {
		const withHead = rows.filter((r) => r.head);
		const commits = new Map<string, ReturnType<typeof parseCommit>>();
		if (withHead.length > 0) {
			const objects = await tx.gitObject.findMany({
				where: {
					OR: withHead.map((r) => ({
						repositoryId: r.id,
						sha: r.head as string,
					})),
				},
			});
			for (const object of objects) {
				commits.set(
					`${object.repositoryId}/${object.sha}`,
					parseCommit(Buffer.from(object.content)),
				);
			}
		}
		return rows.map((row) => {
			const commit = row.head
				? commits.get(`${row.id}/${row.head}`)
				: undefined;
			return {
				id: row.id as RepositoryId,
				courseId: row.courseId as CourseId,
				slug: row.slug,
				title: row.title,
				head: row.head,
				tree: commit?.tree ?? null,
				message: commit ? commit.message.replace(/\n+$/, "") : null,
				committedAt: commit?.committer.date ?? null,
				cloneUrl: `${this.publicUrl}/git/${row.token}/${row.slug}.git`,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			};
		});
	}

	private async commitOf(tx: PrismaTx, repositoryId: number, sha: string) {
		const object = await tx.gitObject.findUniqueOrThrow({
			where: { repositoryId_sha: { repositoryId, sha } },
		});
		return parseCommit(Buffer.from(object.content));
	}

	private async treeOf(
		tx: PrismaTx,
		repositoryId: number,
		sha: string,
	): Promise<GitTreeEntry[]> {
		const object = await tx.gitObject.findUniqueOrThrow({
			where: { repositoryId_sha: { repositoryId, sha } },
		});
		return parseTree(Buffer.from(object.content));
	}

	/// The entries of the directory at `segments` under the tree `root`, or
	/// `null` when some segment is missing or is a file.
	private async dirAt(
		tx: PrismaTx,
		repositoryId: number,
		root: string,
		segments: string[],
	): Promise<GitTreeEntry[] | null> {
		let entries = await this.treeOf(tx, repositoryId, root);
		for (const segment of segments) {
			const next = entries.find(
				(e) => e.name === segment && e.mode === "40000",
			);
			if (!next) return null;
			entries = await this.treeOf(tx, repositoryId, next.sha);
		}
		return entries;
	}

	/// Every file under the tree `sha`, with paths prefixed by `prefix`.
	private async flatten(
		tx: PrismaTx,
		repositoryId: number,
		sha: string,
		prefix: string,
	): Promise<{ path: string; mode: "100644" | "100755"; sha: string }[]> {
		const out: { path: string; mode: "100644" | "100755"; sha: string }[] = [];
		for (const entry of await this.treeOf(tx, repositoryId, sha)) {
			const path = `${prefix}${entry.name}`;
			if (entry.mode === "40000") {
				out.push(
					...(await this.flatten(tx, repositoryId, entry.sha, `${path}/`)),
				);
			} else {
				out.push({ path, mode: entry.mode, sha: entry.sha });
			}
		}
		return out;
	}

	/// Renames an attachment and its on-disk link, refreshing the mime type.
	private async rename(
		tx: PrismaTx,
		attachment: { id: AttachmentId; hash: string; filename: string },
		filename: string,
	): Promise<void> {
		if (attachment.filename === filename) return;
		await this.blob.link(attachment.hash, filename);
		await tx.attachment.update({
			where: { id: attachment.id },
			data: { filename, mimeType: mimeFor(filename) },
		});
		const siblings = await tx.attachment.count({
			where: { hash: attachment.hash, filename: attachment.filename },
		});
		if (siblings === 0)
			await this.blob.unlink(attachment.hash, attachment.filename);
	}

	/// Detaches the repository's attachments of `hash`.
	private async releaseHash(
		tx: PrismaTx,
		repositoryId: number,
		hash: string,
		opts: ServiceOpts,
	): Promise<void> {
		const rows = await tx.attachment.findMany({
			where: { hash, ...ownedBy(repositoryId) },
			select: { id: true },
		});
		for (const row of rows) await this.attachment.delete({ id: row.id }, opts);
	}

	/// Detaches the file attachments no tree of the repository points at.
	private async dropAbandoned(
		tx: PrismaTx,
		repositoryId: number,
		opts: ServiceOpts,
	): Promise<void> {
		const referenced = new Set<string>();
		const trees = await tx.gitObject.findMany({
			where: { repositoryId, type: "TREE" },
			select: { content: true },
		});
		for (const tree of trees) {
			for (const entry of parseTree(Buffer.from(tree.content))) {
				if (entry.mode !== "40000") referenced.add(entry.sha);
			}
		}
		const attachments = await tx.attachment.findMany({
			where: ownedBy(repositoryId),
			include: { blob: { select: { gitSha: true } } },
		});
		for (const attachment of attachments) {
			const sha = attachment.blob.gitSha;
			if (sha && referenced.has(sha)) continue;
			await this.attachment.delete({ id: attachment.id }, opts);
		}
	}

	/// H1 of the root `README.md` of the tree, else the slug.
	private async titleOf(tree: RepositoryCommit["tree"], slug: string) {
		const readme = tree.find((entry) => entry.path === "README.md");
		if (!readme) return slug;
		const bytes = await this.blob.readBlob({
			hash: readme.hash,
			deletedAt: null,
		});
		return (bytes && readmeTitle(bytes.toString("utf8"))) || slug;
	}
}

//
// Auxiliary functions
//

/// What every read loads: the course, as the course permissions need it.
const COURSE_SELECT = {
	id: true,
	instructor: { select: { username: true } },
	enrollments: {
		where: { status: "ACTIVE" as const },
		select: { username: true },
	},
} satisfies Prisma.CourseSelect;

const REPOSITORY_INCLUDE = {
	course: { select: COURSE_SELECT },
} satisfies Prisma.RepositoryInclude;

type DbRepository = Prisma.RepositoryGetPayload<{
	include: typeof REPOSITORY_INCLUDE;
}>;

/// Clone tokens are 24 random bytes in base64url.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function newToken(): string {
	return randomBytes(24).toString("base64url");
}

function repositoryWhere(pk: RepositoryPK): Prisma.RepositoryWhereInput {
	if ("id" in pk) return { id: pk.id };
	return { slug: pk.slug, course: courseRefMatch(pk.course) };
}

/// The attachments that belong to repository `id`.
function ownedBy(id: number) {
	return { attachedToType: "REPOSITORY" as const, attachedToId: id };
}

/// The name an uploaded file carries until a commit gives it a path.
function placeholderName(hash: string): string {
	return `${hash}.bin`;
}

/// The attachment name for a repository path: its sanitised basename, or
/// `null` when nothing valid is left of it.
function attachmentName(path: string): string | null {
	try {
		return sanitizeFilename(path.split("/").pop() as string);
	} catch {
		return null;
	}
}

function signatureOf(actor: Actor, date: Date) {
	if (actor === SYSTEM) {
		return { name: "Codehood", email: "system@codehood", date };
	}
	const name = actor.name.replace(/[<>\n]/g, "").trim();
	return {
		name: name || actor.username,
		email: `${actor.username}@codehood`,
		date,
	};
}

function commitMessage(message: string | null | undefined, date: Date): string {
	const text = message ?? `Update ${date.toISOString().slice(0, 10)}`;
	return text.endsWith("\n") ? text : `${text}\n`;
}

/// The text of the first ATX level-1 heading outside a code fence.
function readmeTitle(markdown: string): string | null {
	let fence: string | null = null;
	for (const line of markdown.split(/\r?\n/)) {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker) {
			if (!fence) fence = marker[0] as string;
			else if (marker[0] === fence) fence = null;
			continue;
		}
		if (fence) continue;
		const heading = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1];
		if (heading) return heading;
	}
	return null;
}
