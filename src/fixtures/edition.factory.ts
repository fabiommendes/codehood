import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { InvalidData } from "@/core/error";
import { db, type Edition, type EditionCreate } from "@/db";
import { type PersistParams, serviceOpts } from "./support";

/**
 * A random slug matching `EDITION_RE`: a four-digit year and a `-<term>`.
 *
 * Random rather than derived from the sequence: every test worker restarts
 * the sequence, and they all share one database.
 */
function fakeEditionSlug(): string {
	const year = faker.number.int({ min: 1000, max: 9999 });
	const term = faker.number.int({ min: 1, max: 99 });
	return `${year}-${term}`;
}

/// How many random slugs {@link persistedEditionFactory} tries before giving up.
const SLUG_ATTEMPTS = 5;

function buildEdition(params: Partial<EditionCreate>): EditionCreate {
	const startAt = faker.date.soon({ days: 1 });
	const endAt = faker.date.soon({ days: 180, refDate: startAt });

	return {
		slug: params.slug ?? fakeEditionSlug(),
		name: `${faker.word.adjective()} term`,
		startAt,
		endAt,
	};
}

/** Builds `EditionCreate` payloads, ready for `editionService.create`. */
export const editionFactory = Factory.define<EditionCreate>(({ params }) =>
	buildEdition(params),
);

/** Builds an `EditionCreate` payload and persists it via `editionService.create`. */
export const persistedEditionFactory = Factory.define<
	EditionCreate,
	PersistParams,
	Edition
>(({ params, transientParams, onCreate }) => {
	// About 900k slugs fit `EDITION_RE`, few enough that a whole suite run can
	// draw the same one twice, so a random slug that is taken is redrawn.
	onCreate(async (input) => {
		for (let attempt = 1; ; attempt++) {
			try {
				return await db.edition.create(input, serviceOpts(transientParams));
			} catch (error) {
				const taken = error instanceof InvalidData && "slug" in error.errors;
				if (params.slug || !taken || attempt === SLUG_ATTEMPTS) throw error;
				input = { ...input, slug: fakeEditionSlug() };
			}
		}
	});

	return buildEdition(params);
});
