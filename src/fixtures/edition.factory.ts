import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { db, type Edition, type EditionCreate } from "@/db";
import { type PersistParams, serviceOpts } from "./support";

/**
 * A slug matching `EDITION_RE`: a four-digit year and a `-<term>`.
 *
 * The term is random rather than derived from the sequence: every test worker
 * restarts the sequence, and they all share one database.
 */
function fakeEditionSlug(sequence: number): string {
	const year = 2024 + (sequence % 10);
	const term = faker.number.int({ min: 1, max: 999_999 });
	return `${year}-${term}`;
}

function buildEdition(
	sequence: number,
	params: Partial<EditionCreate>,
): EditionCreate {
	const startAt = faker.date.soon({ days: 1 });
	const endAt = faker.date.soon({ days: 180, refDate: startAt });

	return {
		slug: params.slug ?? fakeEditionSlug(sequence),
		name: `${faker.word.adjective()} term`,
		startAt,
		endAt,
	};
}

/** Builds `EditionCreate` payloads, ready for `editionService.create`. */
export const editionFactory = Factory.define<EditionCreate>(
	({ sequence, params }) => buildEdition(sequence, params),
);

/** Builds an `EditionCreate` payload and persists it via `editionService.create`. */
export const persistedEditionFactory = Factory.define<
	EditionCreate,
	PersistParams,
	Edition
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate((input) => db.edition.create(input, serviceOpts(transientParams)));

	return buildEdition(sequence, params);
});
