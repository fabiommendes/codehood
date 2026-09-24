import { Factory } from "fishery";
import { db, type Passphrase, type PassphraseCreate, type schema } from "@/db";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

function buildPassphrase(params: Partial<PassphraseCreate>): PassphraseCreate {
	return {
		course: params.course ?? (0 as schema.CourseId),
		value: params.value,
	};
}

/** Builds `PassphraseCreate` payloads, ready for `passphraseService.create`. */
export const passphraseFactory = Factory.define<
	PassphraseCreate,
	unknown,
	PassphraseCreate,
	Partial<PassphraseCreate>
>(({ params }) => buildPassphrase(params));

/**
 * Builds a `PassphraseCreate` payload and persists it via
 * `passphraseService.create`.
 *
 * `course` is provisioned automatically (a fresh course) when left unset.
 */
export const persistedPassphraseFactory = Factory.define<
	PassphraseCreate,
	PersistParams,
	Passphrase,
	Partial<PassphraseCreate>
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const course =
			params.course ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		return db.passphrase.create({ ...input, course }, opts);
	});

	return buildPassphrase(params);
});
