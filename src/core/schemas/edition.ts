import { z } from "zod";
import "./base";
import { m } from "@/i18n";
import { editionSlug, isoDate } from "./base";

export const editionSchema = z.object({
	slug: editionSlug,
	name: z.string().min(1),
	startDate: isoDate,
	endDate: isoDate,
	createdAt: z.date(),
});

export const editionCreate = editionSchema
	.pick({ slug: true, name: true })
	.extend({ startDate: isoDate, endDate: isoDate });

/**
 * The edition form: the fields of {@link editionCreate} as the browser submits
 * them. It both creates an edition and edits one (the slug then rides along as
 * the key and is not editable).
 */
export const editionForm = editionCreate
	.extend({
		slug: editionSlug.meta({
			form: { label: m.forms_label_slug(), placeholder: "2026-2" },
		}),
		name: editionSchema.shape.name.meta({
			form: {
				label: m.forms_label_name(),
				placeholder: m.forms_placeholder_edition_name(),
			},
		}),
		startDate: isoDate.meta({
			form: { label: m.forms_label_edition_starts() },
		}),
		endDate: isoDate.meta({ form: { label: m.forms_label_edition_ends() } }),
	})
	.refine((edition) => edition.endDate >= edition.startDate, {
		path: ["endDate"],
		message: m.forms_schema_edition_end_after_start(),
	});

export const editionUpdate = editionSchema
	.pick({ name: true })
	.extend({ startDate: isoDate, endDate: isoDate })
	.partial();

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
