import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import {
	type File,
	type FileCreate,
	fileService,
} from "@/db/services/file.service";
import { type PersistParams, serviceOpts } from "./support";

function buildFile(): FileCreate {
	return {
		bytes: Buffer.from(faker.lorem.paragraphs(2), "utf-8"),
		mimeType: "text/plain",
	};
}

/** Builds `FileCreate` payloads, ready for `fileService.create`. */
export const fileFactory = Factory.define<FileCreate>(() => buildFile());

/** Builds a `FileCreate` payload and persists it via `fileService.create`. */
export const persistedFileFactory = Factory.define<
	FileCreate,
	PersistParams,
	File
>(({ transientParams, onCreate }) => {
	onCreate((input) => fileService.create(input, serviceOpts(transientParams)));

	return buildFile();
});
