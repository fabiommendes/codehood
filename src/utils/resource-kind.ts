import { extensionForMime } from "./mime";

/// The part of a resource's data that says what kind of thing it is.
type ResourceKindData =
	| { type: "FILE"; mimeType: string }
	| { type: "LINK" }
	| { type: "MD" }
	| { type: "CODE"; language: string };

/**
 * What kind of resource this is, in the words a reader uses for it.
 *
 * A file reads as its extension ("PDF file"), never as its MIME type.
 *
 * @example
 * resourceKind({ type: "FILE", mimeType: "application/pdf" }); // "PDF file"
 */
export function resourceKind(data: ResourceKindData): string {
	switch (data.type) {
		case "FILE": {
			const extension = extensionForMime(data.mimeType);
			return extension ? `${extension.toUpperCase()} file` : "File";
		}
		case "LINK":
			return "Link";
		case "MD":
			return "Note";
		case "CODE":
			return data.language;
	}
}
