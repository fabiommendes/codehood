import { z } from "zod";
import { DISCIPLINE_SLUG_RE, RESERVED_SLUGS } from "@/urls/constants";
import "./base";

export const disciplineSchema = z.object({
	slug: z.string().min(1),
	name: z.string().min(1),
	createdAt: z.date(),
});

export const disciplineCreate = disciplineSchema
	.pick({
		slug: true,
		name: true,
	})
	.extend({
		slug: z
			.string()
			.regex(
				DISCIPLINE_SLUG_RE,
				"Use lowercase letters, digits and hyphens, starting with a letter (3 to 32 characters).",
			)
			.refine((slug) => !RESERVED_SLUGS.has(slug), "This slug is reserved.")
			.openapi({ example: "calculus-1" }),
	});

export const disciplineUpdate = disciplineSchema
	.pick({
		name: true,
	})
	.partial();

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
