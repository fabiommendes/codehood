import { z } from "zod";
import { attachmentSchema } from "./attachment";
import {
	buffer,
	calendarEventId,
	courseId,
	resourceId,
	rev,
	slug,
} from "./base";
import { blobHash } from "./blob";
import { courseRef } from "./course";

/// A calendar event of the resource's course, by the natural key the CLI
/// writes: the week, counted from 0, and the time slot's slug.
export const resourceEventKey = z.object({
	week: z.number().int().min(0),
	timeSlot: slug,
});

export const resourceSchema = z.object({
	id: resourceId,
	courseId: courseId,
	slug: z.string().min(1),
	title: z.string().min(1),
	description: z.string().nullable(),
	data: z.union([
		z.lazy(() => resourceLinkData),
		z.lazy(() => resourceFileData),
		z.lazy(() => resourceCodeData),
		z.lazy(() => resourceMdData),
	]),
	/// The meeting the resource belongs to, or null for a general resource.
	event: resourceEventKey.extend({ id: calendarEventId }).nullable(),
	rev: rev.nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const resourceTypeSchema = z.enum(["LINK", "FILE", "CODE", "MD"]);

// Those are high level representations of resource-specific data.
// The db stores this information in the data/extra columns for each resource.
export const resourceLinkData = z.object({
	type: z.literal("LINK"),
	/// Web URLs only: the link lands in an `<a href>`, where a `javascript:`
	/// or `data:` URL would run script on the app's origin.
	url: z.url({ protocol: /^https?$/ }),
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

/// A `FILE` whose bytes are a blob the server already has, or one sent in
/// the same multipart request under its sha-256.
export const resourceFileDataRef = resourceFileData
	.pick({ filename: true })
	.extend({ type: z.literal("FILE"), hash: blobHash });

// Exactly one of `courseId`/`courseRef` is required. The service checks it,
// not a refinement, because the REST API derives its body with `.omit()`.
export const resourceCreate = resourceSchema
	.omit({
		id: true,
		courseId: true,
		createdAt: true,
		updatedAt: true,
		description: true,
		data: true,
		event: true,
	})
	.extend({
		course: courseRef,
		slug: slug,
		description: resourceSchema.shape.description.nullish(),
		/// Omitted means a general resource on create and upsert, and
		/// unchanged on update.
		event: resourceEventKey.nullish(),
		rev: rev.nullish(),
		data: z.union([
			resourceLinkData,
			resourceFileDataCreate,
			resourceFileDataRef,
			resourceCodeData,
			resourceMdData,
		]),
	});

/// The REST body of a create or upsert: a `FILE` names its blob by hash,
/// since no JSON value is a `Buffer`.
export const resourceCreateRest = resourceCreate.extend({
	data: z.union([
		resourceLinkData,
		resourceFileDataRef,
		resourceCodeData,
		resourceMdData,
	]),
});

export const resourceUpdate = resourceCreate
	.omit({ slug: true, course: true })
	.partial();

/// The REST body of an update, see {@link resourceCreateRest}.
export const resourceUpdateRest = resourceCreateRest
	.omit({ slug: true, course: true })
	.partial();

export const resourcePK = z.union([
	z.object({ id: resourceId }),
	z.object({ course: courseRef, slug: slug }),
]);

export const resourceFilterBase = z.object({
	types: z.array(resourceTypeSchema).optional(),
	slugs: z.array(z.string()).optional(),
});

export const resourceFilter = resourceFilterBase.extend({
	course: courseRef,
	/// An id lists that event's resources, null the general ones only.
	event: calendarEventId.nullable().optional(),
});
