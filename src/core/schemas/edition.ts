import { z } from "zod";
import "./base";
import { dateInput, editionSlug } from "./base";

export const editionSchema = z.object({
	slug: editionSlug,
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

/**
 * The edition form: the fields of {@link editionCreate} as the browser submits
 * them. It both creates an edition and edits one (the slug then rides along as
 * the key and is not editable).
 */
export const editionForm = editionCreate
	.extend({
		slug: editionSlug.meta({ form: { placeholder: "2026-2" } }),
		name: editionSchema.shape.name.meta({
			form: { placeholder: "Second term" },
		}),
		startAt: dateInput.meta({ form: { label: "Starts" } }),
		endAt: dateInput.meta({ form: { label: "Ends" } }),
	})
	.refine((edition) => edition.endAt > edition.startAt, {
		path: ["endAt"],
		message: "Must be after the start date.",
	});

export const editionUpdate = editionSchema
	.pick({
		name: true,
		startAt: true,
		endAt: true,
	})
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
