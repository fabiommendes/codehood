import { z } from "zod";
import { attachmentId, buffer, mimeType, resourceId, username } from "./base";
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
	]),
	createdAt: z.date(),
});

export const attachmentToType = z.enum(["RESOURCE", "QUESTION"]);

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

export const attachmentCreate = attachmentSchema
	.pick({ filename: true })
	.extend({
		buffer: buffer,
		uploaderId: username.optional(),
		attachedTo: z.union([
			attachedToResource.pick({ type: true, id: true }),
			attachedToQuestion.pick({ type: true, id: true }),
		]),
	});

export const attachmentUpdate = attachmentSchema.pick({ filename: true });

export const attachmentPK = z.object({ id: attachmentId });

export const attachmentFilter = z.object({
	ids: z.array(attachmentId).optional(),
	hashes: z.array(blobHash).optional(),
	type: attachmentToType.optional(),
	attachedTo: z.array(z.number().int()).optional(),
	uploader: z.string().optional(),
});
