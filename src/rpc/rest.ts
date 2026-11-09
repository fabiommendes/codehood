import {
	executeRestBatch,
	restBatchInput,
	restBatchOutput,
} from "@/api/registry";
import "@/api/registry/dynamicHandler";
import { METHOD } from "./registry";

export const batch = METHOD("rest.batch", {
	in: restBatchInput,
	out: restBatchOutput,
	tags: ["REST"],
	summary:
		"Run homogeneous JSON REST operations sequentially, with individual results.",
	description:
		"Accepts GET, POST, PUT, PATCH or DELETE and 1–50 requests. Each item is limited to 64 KiB. Paths must be local /api/ paths. GET/DELETE use query; other verbs use body. Authentication, multipart and unregistered routes are excluded. No global transaction.",
	handler: async ({ body, context }) => {
		if (!context) throw new Error("REST batch requires a request context.");
		return executeRestBatch(body, context);
	},
});
