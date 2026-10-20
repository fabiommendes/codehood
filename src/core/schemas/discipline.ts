import { z } from "zod";
import { DISCIPLINE_SLUG_RE, RESERVED_SLUGS } from "@/urls/constants";
import "./base";
import { m } from "@/i18n";

export const disciplineSchema = z.object({
	slug: z.string().min(1),
	name: z
		.string()
		.min(1)
		.meta({
			form: {
				label: m.forms_label_name(),
				placeholder: m.forms_placeholder_discipline_name(),
			},
		}),
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
			.regex(DISCIPLINE_SLUG_RE, m.forms_schema_discipline_slug_invalid())
			.refine(
				(slug) => !RESERVED_SLUGS.has(slug),
				m.forms_schema_slug_reserved(),
			)
			.openapi({ example: "calculus-1" })
			// After `.openapi()`: it clones the schema and the clone would lose the meta.
			.meta({
				form: { label: m.forms_label_slug(), placeholder: "cs102" },
			}),
	});

/// The edit form: the discipline's name, keyed by the (read-only) slug.
export const disciplineEdit = disciplineSchema.pick({
	slug: true,
	name: true,
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
