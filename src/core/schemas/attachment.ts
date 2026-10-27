import { z } from "zod";
import {
	attachmentId,
	buffer,
	mimeType,
	publicId,
	reportId,
	repositoryId,
	resourceId,
	slug,
	username,
} from "./base";
import { blobHash } from "./blob";
import { userInfo } from "./user";

export const attachmentSchema = z.object({
	id: attachmentId,
	hash: blobHash,
	filename: z.string().min(1),
	size: z.number().int(),
	link: z.string().min(1),
	mimeType: mimeType,
	uploader: userInfo.nullable(),
	attachedTo: z.union([
		z.lazy(() => attachedToResource),
		z.lazy(() => attachedToQuestion),
		z.lazy(() => attachedToReport),
		z.lazy(() => attachedToRepository),
	]),
	createdAt: z.date(),
});

export const attachmentToType = z.enum([
	"RESOURCE",
	"QUESTION",
	"REPORT",
	"REPOSITORY",
]);

export const attachedToResource = z.object({
	type: z.literal("RESOURCE"),
	title: z.string().min(1),
	slug: z.string().min(1),
	id: resourceId,
});

export const attachedToQuestion = z.object({
	type: z.literal("QUESTION"),
	title: z.string().min(1),
	id: z.number().int(), //TODO: questionId
	slug: z.string().min(1),
});

export const attachedToReport = z.object({
	type: z.literal("REPORT"),
	id: reportId,
	publicId: publicId,
});

export const attachedToRepository = z.object({
	type: z.literal("REPOSITORY"),
	id: repositoryId,
	slug: slug,
});

export const attachmentCreate = attachmentSchema
	.pick({ filename: true })
	.extend({
		buffer: buffer,
		// Only honoured for SYSTEM callers, which have no actor to derive it
		// from; any other caller gets `uploaderId` from `opts.actor` instead.
		uploaderId: username.optional(),
		attachedTo: z.union([
			attachedToResource.pick({ type: true, id: true }),
			attachedToQuestion.pick({ type: true, id: true }),
			attachedToReport.pick({ type: true, id: true }),
			attachedToRepository.pick({ type: true, id: true }),
		]),
	});

/// Attaches a blob already stored on the server, without sending its bytes.
export const attachmentAttach = attachmentCreate
	.omit({ buffer: true })
	.extend({ hash: blobHash });

export const attachmentUpdate = attachmentSchema.pick({ filename: true });

export const attachmentPK = z.object({ id: attachmentId });

export const attachmentFilter = z.object({
	ids: z.array(attachmentId).optional(),
	hashes: z.array(blobHash).optional(),
	type: attachmentToType.optional(),
	attachedTo: z.array(z.number().int()).optional(),
	uploader: z.string().optional(),
});
