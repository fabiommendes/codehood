import { faker } from "@faker-js/faker";
import { type DeepPartial, Factory } from "fishery";
import type { ResourceId } from "@/core/schemas";
import { type Attachment, type AttachmentCreate, db } from "@/db";
import { type PersistParams, serviceOpts } from "./support";

function buildAttachment(
	sequence: number,
	params: DeepPartial<AttachmentCreate>,
): AttachmentCreate {
	return {
		buffer: Buffer.from(`${faker.lorem.paragraphs(2)} ${sequence}`, "utf-8"),
		filename: `file-${sequence}.txt`,
		attachedTo: {
			type: "RESOURCE",
			id: (params.attachedTo?.id as ResourceId) ?? sequence,
		},
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
		db.attachment.create(input, serviceOpts(transientParams)),
	);

	return buildAttachment(sequence, params);
});
