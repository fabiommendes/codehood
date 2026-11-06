import { z } from "zod";
import { m } from "@/i18n";
import { apiKeyId, publicId, username } from "./base";
import { userInfo } from "./user";

export const apiKeySchema = z.object({
	id: apiKeyId,
	publicId: publicId,
	keyHash: z.string(),
	name: z.string().min(1),
	kind: z.enum(["CLI", "BOT"]),
	createdBy: userInfo,
	lastUsedAt: z.date().nullable(),
	createdAt: z.date(),

	/** Token is only shown in the `create` response. Undefined in all other cases. */
	token: z.string().optional(),
});

/// A BOT key's name becomes the `bot` of the feedback it writes.
const BOT_NAME_RE = /^[a-z0-9-]{1,40}$/;

export const apiKeyCreate = apiKeySchema
	.pick({
		name: true,
		kind: true,
		createdBy: true,
	})
	.refine((key) => key.kind !== "BOT" || BOT_NAME_RE.test(key.name), {
		path: ["name"],
		message: m.forms_schema_bot_key_name(),
	});
export const apiKeyPK = z.union([
	z.object({ id: apiKeyId }),
	z.object({ publicId: publicId }),
]);
export const apiKeyFilter = z.object({ createdBy: username });

/// What the form that creates an API key sends.
export const apiKeyForm = z.object({
	name: z
		.string()
		.trim()
		.min(1)
		.meta({
			form: {
				label: m.forms_label_key_name(),
				placeholder: m.forms_placeholder_key_name(),
			},
		}),
	kind: apiKeySchema.shape.kind,
});

/// Revokes the API key with this public id.
export const apiKeyRevoke = z.object({ publicId: z.string().min(1) });
