/**
 * Configuration of this Codehood instance.
 *
 * A deployment points `CODEHOOD_CONFIG` at its own file instead of editing
 * this one. Values marked "build-time constant" are baked into the build: in
 * production they change with the next `pnpm run build`; the dev server
 * restarts by itself when this file changes. The others are read again at
 * every boot, which is why they may come from the environment.
 *
 * Process settings and secrets stay in the environment: `ENVIRONMENT`,
 * `DATABASE_URL`, `DEBUG`, `LOG_ENV`.
 */

import scheme from "@codehood/runner-scheme";
import { defineConfig, env } from "@/config";
import { defaultRunners, elm, lua, prolog } from "@/runner/plugins";

export default defineConfig({
	instance: {
		publicUrl: "http://localhost:4321", // build-time constant
		locale: "en", // build-time constant; a locale of project.inlang
		timeZone: "America/Sao_Paulo", // build-time constant
		// Regex over the whole school id (e.g. "[0-9]{9}"); empty accepts any.
		schoolIdPattern: env("SCHOOL_ID_PATTERN", ""),
	},
	storage: {
		resourceRoot: env("RESOURCE_ROOT", "./storage/resources"),
		// symlink, hardlink or copy.
		attachmentLinkMode: env("ATTACHMENT_LINK_MODE", "symlink"),
		quota: {
			instructor: env("BLOB_QUOTA_INSTRUCTOR", "1gb"),
			student: env("BLOB_QUOTA_STUDENT", "200mb"),
		},
	},
	runner: {
		// build-time constant. Null: in development, publicUrl on the other
		// loopback name (localhost <-> 127.0.0.1); in production, no code runner.
		origin: null,
		// build-time constant. Without this key, defaultRunners(): Python,
		// JavaScript and TypeScript.
		languages: [...defaultRunners(), lua(), prolog(), elm(), scheme()],
	},
});
