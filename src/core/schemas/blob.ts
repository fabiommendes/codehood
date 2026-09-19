import { z } from "zod";
import "./base";

export const blobSchema = z.object({
	hash: z
		.string()
		.regex(
			/^[0-9a-f]{64}$/,
			"Not a blob hash: expected 64 lowercase hex digits.",
		),
	size: z.number(),
	deletedAt: z.date().nullable(),
	createdAt: z.date(),
});

export const blobHash = blobSchema.shape.hash;

export const blobCreate = z.object({
	bytes: z
		.instanceof(Buffer)
		.openapi("Buffer", { type: "string", format: "binary" }),
});

export const blobPK = z.object({ hash: blobHash });

export const blobFilter = z.object({
	hashes: z.array(blobHash).optional(),
	unattached: z.boolean().optional(),
});
