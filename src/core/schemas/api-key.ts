import { z } from "zod";
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
export const apiKeyCreate = apiKeySchema.pick({
	name: true,
	kind: true,
	createdBy: true,
});
export const apiKeyPK = z.union([
	z.object({ id: apiKeyId }),
	z.object({ publicId: publicId }),
]);
export const apiKeyFilter = z.object({ createdBy: username });
