/**
 * The files of an upload question of an attempt: sending, removing, and which
 * of them stay attached to the attempt.
 *
 * It sits beside `response.service.ts`, which builds it with the attempt
 * lookups it owns and delegates the public methods to it.
 */
import { maxSizeBytes } from "mdq";
import type { z } from "zod";
import { type Actor, SYSTEM, type UserActor } from "@/auth/actor";
import { generateToken } from "@/auth/token";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { QuestionRefId, ResponseId } from "@/core/schemas/base";
import { MAX_UPLOAD_BYTES } from "@/core/schemas/blob";
import type {
	responseFileList,
	responseRemoveFile,
	responseSubmissionFile,
	responseUploadFile,
} from "@/core/schemas/response";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { touch } from "@/db/conditional-write";
import { m } from "@/i18n";
import type { QuestionDocument } from "@/mdq";
import { uploadFilename } from "@/services/upload-filename";
import {
	JsonNull,
	type Prisma,
	type PrismaClient,
	type PrismaTx,
} from "../client";
import type { AttachmentService } from "./attachment.service";
import type { BlobService } from "./blob.service";
import { loadExceptionTiming } from "./exam-questions";
import {
	assertAcceptingSubmissions,
	loadExamQuestion,
} from "./submission.service";

export type UploadFileInput = z.infer<typeof responseUploadFile>;
export type RemoveFileInput = z.infer<typeof responseRemoveFile>;
export type SubmissionFileInput = z.infer<typeof responseSubmissionFile>;
export type FileList = z.infer<typeof responseFileList>;

/// One file of an upload answer, as the submission stores it.
interface FileItem {
	name: string;
	path: string;
	size: number;
}

/// The attempt of an upload write, as the attempt lookups of the response service return it.
type FileAttempt = Parameters<typeof assertAcceptingSubmissions>[0] & {
	id: ResponseId;
	examId: number;
	authorId: string;
};

interface Located {
	attempt: FileAttempt | null;
	courseId: number;
	examId: number;
	exception: Parameters<typeof assertAcceptingSubmissions>[2] | undefined;
}

/// How the response service finds the attempt an upload write belongs to.
export interface AttemptAccess {
	/// Checks the write and finds the attempt without opening one.
	inspect(
		tx: PrismaTx,
		input: { course: UploadFileInput["course"]; exam: string; author?: string },
		actor: Actor,
	): Promise<Located>;
	/// Finds the attempt, opening it when there is none.
	open(
		tx: PrismaTx,
		input: { course: UploadFileInput["course"]; exam: string; author?: string },
		actor: Actor,
	): Promise<Located>;
	/// Finds a submission of the exam by public id, refusing an actor who may not read its attempt.
	readable(
		tx: PrismaTx,
		input: SubmissionFileInput,
		actor: Actor,
	): Promise<{ attemptId: ResponseId; payload: unknown }>;
}

/// The question, and the files its answer holds now.
interface State {
	located: Located;
	question: { id: QuestionRefId; type: string };
	document: QuestionDocument;
	files: FileItem[];
}

/// The student's newest answer to a question is the one that holds its files.
async function currentFiles(
	tx: PrismaTx,
	responseId: ResponseId,
	questionId: QuestionRefId,
): Promise<FileItem[]> {
	const row = await tx.submission.findFirst({
		where: { responseId, questionId, createdById: null },
		orderBy: { id: "desc" },
		select: { payload: true },
	});
	return filesOf(row?.payload);
}

function filesOf(payload: unknown): FileItem[] {
	return Array.isArray(payload) ? (payload as FileItem[]) : [];
}

/// Whether two lists name the same files in the same order.
function sameFiles(a: readonly FileItem[], b: readonly FileItem[]): boolean {
	return (
		a.length === b.length &&
		a.every(
			(item, i) =>
				item.name === b[i]?.name &&
				item.path === b[i]?.path &&
				item.size === b[i]?.size,
		)
	);
}

/// Runs `body` in a write transaction on `tx`, or on `tx` itself when it already is one.
function inWrite<R>(
	tx: PrismaTx,
	body: (inner: PrismaTx) => Promise<R>,
): Promise<R> {
	return "$connect" in tx
		? (tx as unknown as PrismaClient).$transaction(body)
		: body(tx);
}

/** Builds the file operations of the response service. */
export function makeResponseFiles(deps: {
	attachments: AttachmentService;
	blob: BlobService;
	attempts: AttemptAccess;
}) {
	const { attachments, blob, attempts } = deps;

	/// Reads the attempt, refuses a write it does not accept, and loads the upload question with its files.
	async function load(
		tx: PrismaTx,
		input: UploadFileInput | RemoveFileInput,
		actor: Actor,
		create: boolean,
	): Promise<State> {
		const located = create
			? await attempts.open(tx, input, actor)
			: await attempts.inspect(tx, input, actor);
		const { attempt } = located;
		if (attempt) {
			assertAcceptingSubmissions(
				attempt,
				new Date(),
				located.exception === undefined
					? await loadExceptionTiming(tx, attempt.examId, attempt.authorId)
					: located.exception,
			);
		}
		const { question, document } = await loadExamQuestion(
			tx,
			located.courseId,
			located.examId,
			input.question,
		);
		if (question.type !== "UPLOAD") {
			throw new InvalidData({
				question: [
					{ code: "invalid", message: m.errors_response_not_upload() },
				],
			});
		}
		return {
			located,
			question,
			document,
			files: attempt ? await currentFiles(tx, attempt.id, question.id) : [],
		};
	}

	/// Checks the file against the question and the list, and returns the stored name.
	function plan(state: State, input: UploadFileInput) {
		const size = input.bytes.length;
		const limit = Math.min(
			MAX_UPLOAD_BYTES,
			maxSizeBytes(state.document as never) ?? MAX_UPLOAD_BYTES,
		);
		if (size === 0) {
			throw new InvalidData({
				bytes: [{ code: "invalid", message: m.errors_response_file_empty() }],
			});
		}
		if (size > limit) {
			throw new InvalidData({
				bytes: [
					{
						code: "invalid",
						message: m.errors_response_file_too_large({ max: limit }),
					},
				],
			});
		}
		const name = uploadFilename(input.filename, state.document as never);
		const replaced = state.files.find((file) => file.name === name);
		const maxFiles = (state.document as { maxFiles?: number }).maxFiles ?? 1;
		if (state.files.length + (replaced ? 0 : 1) > maxFiles) {
			throw new InvalidData({
				files: [
					{
						code: "invalid",
						message: m.errors_response_too_many_files({ max: maxFiles }),
					},
				],
			});
		}
		return { name, size, replaced };
	}

	/// Refuses the file when it puts the actor over quota, counting the file it replaces as freed.
	async function assertQuota(
		actor: Actor,
		size: number,
		replaced: FileItem | undefined,
	): Promise<void> {
		if (actor === SYSTEM) return;
		const user = actor as UserActor;
		const quota = attachments.quotaFor(user.role);
		if (quota === null) return;
		const usage = await attachments.usageBytes(user.username, {
			actor: SYSTEM,
		});
		if (usage - (replaced?.size ?? 0) + size > quota) {
			throw new NotAllowed("attachment.create");
		}
	}

	/**
	 * Detaches the files of the attempt that no answer keeps.
	 *
	 * An answer keeps its files when it is the student's newest to an upload question, or has feedback or a regrade request. `replacing` stands for the newest answer of its question when that is not written yet.
	 */
	async function release(
		tx: PrismaTx,
		attemptId: ResponseId,
		replacing?: { questionId: QuestionRefId; files: readonly FileItem[] },
	): Promise<void> {
		const rows = await tx.submission.findMany({
			where: { responseId: attemptId, question: { type: "UPLOAD" } },
			orderBy: { id: "desc" },
			select: {
				questionId: true,
				payload: true,
				createdById: true,
				feedbacks: { select: { id: true }, take: 1 },
				regradeRequest: { select: { id: true } },
			},
		});
		const keep: Array<{ hash: string; filename: string }> = [];
		const cite = (files: readonly FileItem[]) => {
			for (const file of files)
				keep.push({ hash: file.path, filename: file.name });
		};
		const newest = new Set<number>();
		if (replacing) {
			newest.add(replacing.questionId);
			cite(replacing.files);
		}
		for (const row of rows) {
			const graded = row.feedbacks.length > 0 || row.regradeRequest !== null;
			if (row.createdById === null && !newest.has(row.questionId)) {
				newest.add(row.questionId);
				cite(filesOf(row.payload));
			} else if (graded) {
				cite(filesOf(row.payload));
			}
		}
		await attachments.detachExcept({ type: "RESPONSE", id: attemptId }, keep, {
			actor: SYSTEM,
			tx,
		});
	}

	/// Writes the student's answer to the question and returns its public id.
	async function write(
		tx: PrismaTx,
		attemptId: ResponseId,
		questionId: QuestionRefId,
		files: FileItem[] | null,
	): Promise<string> {
		const publicId = generateToken(9);
		await tx.submission.create({
			data: {
				publicId,
				responseId: attemptId,
				questionId,
				payload: files ? (files as unknown as Prisma.InputJsonValue) : JsonNull,
			},
		});
		return publicId;
	}

	/**
	 * Stores one file as the answer to an upload question, replacing the file of the same name.
	 *
	 * Everything that can refuse the file is checked before its bytes reach the disk.
	 *
	 * @throws {@link InvalidData} If the attempt is closed, the question is not an upload one, or the file does not fit it.
	 * @throws {@link NotAllowed} If the actor may not write the author's work or the file is over their quota.
	 * @throws {@link NotFound} If the question is not in the exam, or the blob keeps being collected.
	 */
	async function uploadFile(
		tx: PrismaTx,
		input: UploadFileInput,
		opts: ServiceOptsWithoutTx,
	): Promise<FileList> {
		const before = await load(tx, input, opts.actor, false);
		const wanted = plan(before, input);
		await assertQuota(opts.actor, wanted.size, wanted.replaced);

		let retried = false;
		for (;;) {
			const stored = await blob.storeBytes(input.bytes, { actor: SYSTEM });
			try {
				return await inWrite(tx, async (inner) => {
					// The lock comes first, so a concurrent send is read after it commits.
					if (before.located.attempt) {
						await touch(
							inner,
							"response",
							{ id: before.located.attempt.id },
							{},
						);
					}
					const state = await load(inner, input, opts.actor, true);
					const { name, size, replaced } = plan(state, input);
					const attempt = state.located.attempt as FileAttempt;
					const item = { name, path: stored.hash, size };
					const files = replaced
						? state.files.map((file) => (file.name === name ? item : file))
						: [...state.files, item];
					await release(inner, attempt.id, {
						questionId: state.question.id,
						files,
					});
					await attachments.attach(
						{
							hash: stored.hash,
							filename: name,
							exactFilename: true,
							attachedTo: { type: "RESPONSE", id: attempt.id },
						},
						{ actor: opts.actor, tx: inner },
					);
					const submission = await write(
						inner,
						attempt.id,
						state.question.id,
						files,
					);
					return { files, submission };
				});
			} catch (error) {
				if (
					!retried &&
					error instanceof NotFound &&
					error.resource === "blob"
				) {
					retried = true;
					continue;
				}
				throw error;
			}
		}
	}

	/**
	 * Removes the file stored under `filename` from an upload question's answer.
	 *
	 * @throws {@link NotFound} If the attempt holds no file of that exact name.
	 * @throws {@link InvalidData} If the attempt is closed or the question is not an upload one.
	 */
	async function removeFile(
		tx: PrismaTx,
		input: RemoveFileInput,
		opts: ServiceOptsWithoutTx,
	): Promise<FileList> {
		const before = await load(tx, input, opts.actor, false);
		if (!before.located.attempt) throw new NotFound("file");
		const attemptId = before.located.attempt.id;
		return inWrite(tx, async (inner) => {
			await touch(inner, "response", { id: attemptId }, {});
			const state = await load(inner, input, opts.actor, false);
			if (!state.files.some((file) => file.name === input.filename)) {
				throw new NotFound("file");
			}
			const rest = state.files.filter((file) => file.name !== input.filename);
			const files = rest.length > 0 ? rest : null;
			const submission = await write(
				inner,
				attemptId,
				state.question.id,
				files,
			);
			await release(inner, attemptId);
			return { files, submission };
		});
	}

	/**
	 * Opens a file a submission cites as a stream, or `null` when the attempt no longer keeps it.
	 *
	 * @throws {@link NotAllowed} If the actor may not read the attempt.
	 * @throws {@link NotFound} If the submission is not in the exam or does not cite a file of that exact name.
	 */
	async function submissionFile(
		tx: PrismaTx,
		input: SubmissionFileInput,
		opts: ServiceOptsWithoutTx,
	): Promise<{
		stream: ReadableStream<Uint8Array>;
		size: number;
		mimeType: string;
	} | null> {
		const { attemptId, payload } = await attempts.readable(
			tx,
			input,
			opts.actor,
		);
		const item = filesOf(payload).find((file) => file.name === input.name);
		if (!item) throw new NotFound("file");
		const attachment = await tx.attachment.findFirst({
			where: {
				attachedToType: "RESPONSE",
				attachedToId: attemptId,
				hash: item.path,
				filename: item.name,
			},
			include: { blob: true },
		});
		if (!attachment) return null;
		const stream = await blob.openBlob(attachment.blob);
		if (!stream) return null;
		return {
			stream,
			size: attachment.blob.size,
			mimeType: attachment.mimeType,
		};
	}

	/**
	 * Refuses an answer to an upload question that is neither no answer nor the files it holds now.
	 *
	 * @throws {@link InvalidData} If the payload would change the list.
	 */
	async function assertAnswer(
		tx: PrismaTx,
		attemptId: ResponseId,
		questionId: QuestionRefId,
		payload: unknown,
	): Promise<void> {
		if (payload === null) return;
		const current = await currentFiles(tx, attemptId, questionId);
		if (
			Array.isArray(payload) &&
			current.length > 0 &&
			sameFiles(payload as FileItem[], current)
		) {
			return;
		}
		throw new InvalidData({
			payload: [
				{ code: "invalid", message: m.errors_response_upload_unchanged() },
			],
		});
	}

	return { uploadFile, removeFile, submissionFile, assertAnswer, release };
}

/// The service the response service builds its file operations with.
export type ResponseFiles = ReturnType<typeof makeResponseFiles>;
