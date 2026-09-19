import { z } from "zod";
import { EDITION_RE } from "@/urls";
import "./base";

export const editionSchema = z.object({
	slug: z.string().regex(EDITION_RE),
	name: z.string().min(1),
	startAt: z.coerce.date(),
	endAt: z.coerce.date(),
	createdAt: z.coerce.date(),
});

export const editionCreate = editionSchema.pick({
	slug: true,
	name: true,
	startAt: true,
	endAt: true,
});

export const editionUpdate = editionSchema
	.pick({
		name: true,
		startAt: true,
		endAt: true,
	})
	.partial();

export const editionUpsert = editionCreate;

export const editionPK = editionSchema.pick({
	slug: true,
});

export const editionFilter = z.object({
	slugs: z.array(z.string()).optional(),
	active: z.boolean().optional(),
});

/**
 * Simplified representation of an edition to be embedded in other entities,
 * e.g. `Course.edition`.
 */
export const editionInfo = editionSchema.pick({ slug: true, name: true });
