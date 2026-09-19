import { z } from "zod";
import { attachmentSchema } from "./attachment";
import { buffer, courseId, resourceId, slug } from "./base";
import { courseNaturalKey } from "./course";

export const resourceSchema = z.object({
	id: resourceId,
	slug: z.string().min(1),
	title: z.string().min(1),
	description: z.string().nullable(),
	data: z.union([
		z.lazy(() => resourceLinkData),
		z.lazy(() => resourceFileData),
		z.lazy(() => resourceCodeData),
		z.lazy(() => resourceMdData),
	]),
	ref: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const resourceTypeSchema = z.enum(["LINK", "FILE", "CODE", "MD"]);

// Those are high level representations of resource-specific data.
// The db stores this information in the data/extra columns for each resource.
export const resourceLinkData = z.object({
	type: z.literal("LINK"),
	url: z.string().min(1),
});

export const resourceFileData = attachmentSchema
	.pick({
		link: true,
		mimeType: true,
		filename: true,
	})
	.extend({ type: z.literal("FILE") });

export const resourceCodeData = z.object({
	type: z.literal("CODE"),
	content: z.string().min(1),
	language: z.string().min(1),
});

export const resourceMdData = z.object({
	type: z.literal("MD"),
	content: z.string().min(1),
});

export const resourceFileDataCreate = resourceFileData
	.omit({
		link: true,
		mimeType: true,
	})
	.extend({
		buffer: buffer,
	});

// Exactly one of `courseId`/`courseRef` is required. The service checks it,
// not a refinement, because the REST API derives its body with `.omit()`.
export const resourceCreate = resourceSchema
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		description: true,
		data: true,
	})
	.extend({
		courseId: z.union([courseId, courseNaturalKey]),
		description: resourceSchema.shape.description.nullish(),
		data: z.union([
			resourceLinkData,
			resourceFileDataCreate,
			resourceCodeData,
			resourceMdData,
		]),
	});

export const resourceUpsert = resourceCreate;

export const resourceUpdate = resourceCreate
	.omit({ slug: true, courseId: true })
	.partial();

export const resourceNaturalKey = courseNaturalKey.extend({ slug: slug });
export const resourcePK = z.union([
	z.object({ id: resourceId }),
	z.object({ courseId: z.number(), slug: slug }),
	resourceNaturalKey,
]);

// What the REST layer accepts, as opposed to what the service resolves: a
// resource's address is `/api/course/<discipline>/<instructor>_<edition>/resource/<slug>`.
export const resourcePkRef = z.object({
	ref: z.object({ courseRef: courseNaturalKey, slug: slug }),
});

export const resourceFilterBase = z.object({
	types: z.array(resourceTypeSchema).optional(),
	slugs: z.array(z.string()).optional(),
});

export const resourceFilterByCourseId = resourceFilterBase.extend({
	courseId: courseId,
});

export const resourceFilterByCourseNaturalKey = resourceFilterBase.extend(
	courseNaturalKey.shape,
);

export const resourceFilter = z.union([
	resourceFilterByCourseId,
	resourceFilterByCourseNaturalKey,
]);
