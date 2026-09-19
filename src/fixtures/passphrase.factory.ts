import { Factory } from "fishery";
import { db, type Passphrase, type PassphraseCreate } from "@/db";
import { persistedCourseFactory } from "./course.factory";
import { type PersistParams, serviceOpts } from "./support";

/** Builds `PassphraseCreate` payloads, ready for `passphraseService.create`. */
export const passphraseFactory = Factory.define<PassphraseCreate>(
	({ params }) => ({
		courseId: params.courseId ?? 0,
	}),
);

/**
 * Builds a `PassphraseCreate` payload and persists it via
 * `passphraseService.create`.
 *
 * `courseId` is provisioned automatically (a fresh course) when left unset.
 */
export const persistedPassphraseFactory = Factory.define<
	PassphraseCreate,
	PersistParams,
	Passphrase
>(({ params, transientParams, onCreate }) => {
	onCreate(async (input) => {
		const opts = serviceOpts(transientParams);
		const courseId =
			params.courseId ??
			(await persistedCourseFactory.create({}, { transient: transientParams }))
				.id;

		return db.passphrase.create({ ...input, courseId }, opts);
	});

	return { courseId: params.courseId ?? 0 };
});
