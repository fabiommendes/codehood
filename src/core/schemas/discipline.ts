import { z } from "zod";
import "./base";

export const disciplineSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1),
	createdAt: z.date(),
});

export const disciplineCreate = disciplineSchema.pick({
	slug: true,
	name: true,
});

export const disciplineUpdate = disciplineSchema
	.pick({
		name: true,
	})
	.partial();

export const disciplineUpsert = disciplineCreate;

export const disciplinePK = disciplineSchema.pick({
	slug: true,
});

export const disciplineFilter = z.object({
	slugs: z.array(z.string()).optional(),
});

/**
 * Simplified representation of a discipline to be embedded in other entities,
 * e.g. `Course.discipline`.
 */
export const disciplineInfo = disciplineSchema.pick({ slug: true, name: true });
