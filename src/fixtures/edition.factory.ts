import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type Edition,
	type EditionCreate,
	editionService,
} from "@/db/services/edition.service";
import { type PersistParams, serviceOpts } from "./support";

/** A slug matching `EDITION_RE`: a four-digit year, optionally `-<term>`. */
function fakeEditionSlug(sequence: number): string {
	const year = 2024 + (sequence % 10);
	const term = (sequence % 2) + 1;
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
	onCreate((input) =>
		editionService.create(input, serviceOpts(transientParams)),
	);

	return buildEdition(sequence, params);
});
