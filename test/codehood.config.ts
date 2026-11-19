/**
 * Configuration of the test server and the test workers.
 *
 * `test/run.ts` points `CODEHOOD_CONFIG` here. Unlike the default file, every
 * value comes from the environment, so each run picks its own port and a
 * spec can start a process with other values.
 */

import { defineConfig, env } from "@/config";
import { defaultRunners, elm, lua, prolog } from "@/runner/plugins";

export default defineConfig({
	instance: {
		publicUrl: env("PUBLIC_URL"),
		locale: env("CODEHOOD_LOCALE"),
		timeZone: env("SERVER_TZ"),
		schoolIdPattern: env("SCHOOL_ID_PATTERN"),
	},
	storage: {
		resourceRoot: env("RESOURCE_ROOT"),
		attachmentLinkMode: env("ATTACHMENT_LINK_MODE"),
		quota: {
			instructor: env("BLOB_QUOTA_INSTRUCTOR"),
			student: env("BLOB_QUOTA_STUDENT"),
		},
		repositoryRoot: env("REPOSITORY_ROOT"),
		assignment: {
			maxRepoBytes: env("ASSIGNMENT_MAX_REPO"),
			maxFileBytes: env("ASSIGNMENT_MAX_FILE"),
		},
	},
	exam: {
		// Short, so a spec that types an answer sees it saved without waiting.
		autosaveIntervalMs: env("EXAM_AUTOSAVE_INTERVAL_MS", "500"),
	},
	runner: {
		origin: env("RUNNER_ORIGIN") ?? null,
		languages: [...defaultRunners(), lua(), prolog(), elm()],
	},
});
