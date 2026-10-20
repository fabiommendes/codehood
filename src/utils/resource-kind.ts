import { m } from "@/i18n";
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
			return extension
				? m.courses_resource_kind_file_ext({
						extension: extension.toUpperCase(),
					})
				: m.courses_resource_kind_file();
		}
		case "LINK":
			return m.courses_resource_kind_link();
		case "MD":
			return m.courses_resource_kind_note();
		case "CODE":
			return data.language;
	}
}

/// The part of a resource its list row describes it by.
type ResourceDetailData = {
	description: string | null;
	data: ResourceKindData | { type: "LINK"; url: string };
};

/**
 * The line under a resource's title in a list: its description, or else what
 * tells it apart from its neighbours (a link's site, a file's kind, a
 * snippet's language).
 *
 * @example
 * resourceDetail({ description: null, data: { type: "LINK", url: "https://www.python.org/doc" } }); // "python.org"
 */
export function resourceDetail(resource: ResourceDetailData): string {
	if (resource.description) return resource.description;
	const { data } = resource;
	if (data.type === "LINK" && "url" in data) {
		try {
			return new URL(data.url).hostname.replace(/^www\./, "");
		} catch {
			return m.courses_resource_kind_link();
		}
	}
	return resourceKind(data);
}
