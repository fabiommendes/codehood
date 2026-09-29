import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { type Discipline, type DisciplineCreate, db } from "@/db";
import { type PersistParams, serviceOpts } from "./support";

/**
 * A slug matching `DISCIPLINE_SLUG_RE`: lowercase, starts with a letter, no trailing hyphen.
 *
 * The sequence alone is not unique enough: it restarts per factory instance,
 * while `slug` is unique across a whole test database, so a random suffix
 * carries the uniqueness instead of faker's short department list.
 */
function fakeDisciplineSlug(sequence: number): string {
	const base = faker.commerce
		.department()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	const suffix = Math.random().toString(36).slice(2, 10);
	return `${base || "discipline"}-${sequence}-${suffix}`;
}

function buildDiscipline(
	sequence: number,
	params: Partial<DisciplineCreate>,
): DisciplineCreate {
	return {
		slug: params.slug ?? fakeDisciplineSlug(sequence),
		// Faker's department list is short; the suffix keeps two courses in one
		// test from sharing a display name.
		name: `${faker.commerce.department()} ${Math.random().toString(36).slice(2, 7)}`,
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
		db.discipline.create(input, serviceOpts(transientParams)),
	);

	return buildDiscipline(sequence, params);
});
