import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type Discipline,
	type DisciplineCreate,
	disciplineService,
} from "@/db/services/discipline.service";
import { type PersistParams, serviceOpts } from "./support";

/** A slug matching `DISCIPLINE_SLUG_RE`: lowercase, starts with a letter, no trailing hyphen. */
function fakeDisciplineSlug(sequence: number): string {
	const base = faker.commerce
		.department()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${base || "discipline"}-${sequence}`;
}

function buildDiscipline(
	sequence: number,
	params: Partial<DisciplineCreate>,
): DisciplineCreate {
	return {
		slug: params.slug ?? fakeDisciplineSlug(sequence),
		name: faker.commerce.department(),
	};
}

/** Builds `DisciplineCreate` payloads, ready for `disciplineService.create`. */
export const disciplineFactory = Factory.define<DisciplineCreate>(
	({ sequence, params }) => buildDiscipline(sequence, params),
);

/** Builds a `DisciplineCreate` payload and persists it via `disciplineService.create`. */
export const persistedDisciplineFactory = Factory.define<
	DisciplineCreate,
	PersistParams,
	Discipline
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate((input) =>
		disciplineService.create(input, serviceOpts(transientParams)),
	);

	return buildDiscipline(sequence, params);
});
