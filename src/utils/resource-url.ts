import { type CourseUrls, external, type LinkTarget, urls } from "@/urls";
import { extensionForMime } from "./mime";
import { slugify } from "./slugify";

/**
 * The download name a `FILE` resource's row links with —
 * `Resource.title`, slugified, with the extension implied by `File.mimeType`.
 * The name belongs to the use (the resource), not to the bytes (the file),
 * which is why it isn't stored on `File`.
 */
export function fileDownloadName(
	resource: { title: string },
	file: { mimeType: string },
): string {
	const base = slugify(resource.title);
	const ext = extensionForMime(file.mimeType);
	return ext ? `${base}.${ext}` : base;
}

/**
 * Where a resource's row leads: the file's download, the link itself, or the
 * resource's own page in `course`.
 */
export function resourceHref(
	resource: {
		slug: string;
		data:
			| { type: "FILE"; link: string; filename: string }
			| { type: "LINK"; url: string }
			| {
					type: "MD" | "CODE";
			  };
	},
	course: CourseUrls,
): LinkTarget {
	switch (resource.data.type) {
		case "FILE": {
			// `link` is `/files/<hash>/<filename>`.
			const hash = resource.data.link.split("/")[2] ?? "";
			return urls.files.named({ hash, name: resource.data.filename });
		}
		case "LINK":
			return external(resource.data.url);
		default:
			return course.resource(resource.slug);
	}
}
