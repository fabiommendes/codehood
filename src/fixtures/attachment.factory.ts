import { faker } from "@faker-js/faker";
import { type DeepPartial, Factory } from "fishery";
import {
	type Attachment,
	type AttachmentCreate,
	attachmentService,
} from "@/db/services/attachment.service";
import { type PersistParams, serviceOpts } from "./support";

function buildAttachment(
	sequence: number,
	params: DeepPartial<AttachmentCreate>,
): AttachmentCreate {
	return {
		bytes: Buffer.from(`${faker.lorem.paragraphs(2)} ${sequence}`, "utf-8"),
		filename: `file-${sequence}.txt`,
		mimeType: "text/plain",
		ownerType: "RESOURCE",
		ownerId: params.ownerId ?? sequence,
	};
}

/** Builds `AttachmentCreate` payloads, ready for `attachmentService.create`. */
export const attachmentFactory = Factory.define<AttachmentCreate>(
	({ sequence, params }) => buildAttachment(sequence, params),
);

/** Builds an `AttachmentCreate` payload and persists it via `attachmentService.create`. */
export const persistedAttachmentFactory = Factory.define<
	AttachmentCreate,
	PersistParams,
	Attachment
>(({ sequence, params, transientParams, onCreate }) => {
	onCreate((input) =>
		attachmentService.create(input, serviceOpts(transientParams)),
	);

	return buildAttachment(sequence, params);
});
