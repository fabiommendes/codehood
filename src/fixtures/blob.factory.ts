import { faker } from "@faker-js/faker";
import { Factory } from "fishery";
import { type Blob, type BlobCreate, db } from "@/db";
import { type PersistParams, serviceOpts } from "./support";

function buildBlob(sequence: number): BlobCreate {
	return {
		bytes: Buffer.from(`${faker.lorem.paragraphs(2)} ${sequence}`, "utf-8"),
	};
}

/** Builds `BlobCreate` payloads, ready for `blobService.create`. */
export const blobFactory = Factory.define<BlobCreate>(({ sequence }) =>
	buildBlob(sequence),
);

/** Builds a `BlobCreate` payload and persists it via `blobService.create`. */
export const persistedBlobFactory = Factory.define<
	BlobCreate,
	PersistParams,
	Blob
>(({ sequence, transientParams, onCreate }) => {
	onCreate((input) => db.blob.create(input, serviceOpts(transientParams)));

	return buildBlob(sequence);
});
