/**
 * Bundle entry of the frame page: reads the `FrameConfig` from the page's
 * `<meta name="runner:<key>">` tags and starts the frame.
 */

import { startFrame } from "../../sandbox/frame";

/// Value of the `<meta name="runner:<key>">` tag.
function meta(key: string): string {
	const content = document
		.querySelector(`meta[name="runner:${key}"]`)
		?.getAttribute("content");
	if (content === null || content === undefined) {
		throw new Error(`Frame page lacks <meta name="runner:${key}">`);
	}
	return content;
}

startFrame({
	appOrigin: meta("appOrigin"),
	bundleBase: new URL(meta("bundleBase"), location.href).href,
	withFake: meta("withFake") === "true",
	exclusive: meta("exclusive") === "true",
});
