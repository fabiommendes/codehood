import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import type { CourseId } from "@/db/services/course.service";
import {
	type Resource,
	type ResourceCreate,
	resourceService,
} from "@/db/services/resource.service";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

/**
 * Defaults to a `LINK` resource — the simplest shape `ResourceService`
 * accepts. Override `type`/`data`/`extra`/`fileId` together to build another
 * kind; see `validateResourceShape` in `resource.service.ts` for the
 * required combination per type.
 */
function buildResource(
	sequence: number,
	params: Partial<ResourceCreate>,
): ResourceCreate {
	return {
		courseId: params.courseId ?? (0 as CourseId),
		slug: params.slug ?? `resource-${sequence}`,
		type: "LINK",
		title: faker.lorem.words(3),
		description: faker.lorem.sentence(),
		data: faker.internet.url(),
		contentHash: faker.string.hexadecimal({ length: 40 }).slice(2),
	};
}

/** Builds `ResourceCreate` payloads, ready for `resourceService.create`. */
export const resourceFactory = Factory.define<
	ResourceCreate,
	unknown,
	ResourceCreate,
	Partial<ResourceCreate>
>(({ sequence, params }) => buildResource(sequence, params));

/**
 * Builds a `ResourceCreate` payload and persists it via `resourceService.create`.
 *
 * `courseId` is provisioned automatically (a fresh course) when left unset.
 */
export const persistedResourceFactory = Factory.define<
	ResourceCreate,
	PersistParams,
	Resource,
	Partial<ResourceCreate>
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const courseId =
			params.courseId ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		return resourceService.create({ ...input, courseId }, opts);
	});

	return buildResource(sequence, params);
});
