import { APP_CSP } from "@codehood/runner/server/routing";
import { db } from "@/db";
import { expect, test } from "./fixtures";
import {
	fresh,
	makeWorld,
	putFile,
	sessionCookie,
	sha256,
	type World,
} from "./response-files-world";
import { logInAs } from "./stories/helpers";

/// Playwright turns Firefox's own PDF viewer off by default; the PDF test needs it.
test.use({
	launchOptions: { firefoxUserPrefs: { "pdfjs.disabled": false } },
});

/// The authenticated download route of the files of an upload answer (R20, R21).

function downloadUrl(w: World, submission: string, name: string) {
	return `${w.examBase}/submission/${submission}/file/${encodeURIComponent(name)}`;
}

const PDF = () => fresh(1500, "%PDF-1.4\n");
const PNG = () =>
	Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		fresh(300),
	]);

test("R21: the author and the course instructor get 200 with the bytes", async ({
	request,
}) => {
	const w = await makeWorld();
	const bytes = PDF();
	const { submission } = await putFile(w, w.pdf, "a.pdf", bytes);
	for (const user of [w.student, w.instructor]) {
		const res = await request.get(downloadUrl(w, submission, "a.pdf"), {
			headers: { cookie: await sessionCookie(user.username) },
		});
		expect(res.status(), user.username).toBe(200);
		expect(Buffer.from(await res.body())).toEqual(bytes);
	}
});

test("R21: another enrolled student gets 404, so the file's existence is not confirmed", async ({
	request,
}) => {
	const w = await makeWorld();
	const { submission } = await putFile(w, w.pdf, "a.pdf", PDF());
	const res = await request.get(downloadUrl(w, submission, "a.pdf"), {
		headers: { cookie: await sessionCookie(w.other.username) },
	});
	expect(res.status()).toBe(404);
});

test("R21: a student asking for a file of the instructor's preview attempt gets 404", async ({
	request,
}) => {
	const w = await makeWorld();
	const preview = await db.response.restartPreview(
		{ course: w.course.id, exam: w.exam.slug },
		{ actor: w.instructor },
	);
	expect(preview.preview).toBe(true);
	const { submission } = await putFile(w, w.pdf, "p.pdf", PDF(), w.instructor);
	const asInstructor = await request.get(downloadUrl(w, submission, "p.pdf"), {
		headers: { cookie: await sessionCookie(w.instructor.username) },
	});
	expect(asInstructor.status()).toBe(200);
	for (const user of [w.student, w.other]) {
		const res = await request.get(downloadUrl(w, submission, "p.pdf"), {
			headers: { cookie: await sessionCookie(user.username) },
		});
		expect(res.status(), user.username).toBe(404);
	}
});

test("R21: without a session the route never serves the file", async ({
	request,
}) => {
	const w = await makeWorld();
	const bytes = PDF();
	const { submission } = await putFile(w, w.pdf, "a.pdf", bytes);
	const res = await request.get(downloadUrl(w, submission, "a.pdf"), {
		headers: { cookie: "" },
	});
	// Exam attachment routes answer 404 to anonymous requests; 401 and 403 are as closed.
	expect([401, 403, 404]).toContain(res.status());
	expect(Buffer.from(await res.body())).not.toEqual(bytes);
});

test("R21: a file the submission never cited is 404", async ({ request }) => {
	const w = await makeWorld();
	const { submission } = await putFile(w, w.pdf, "a.pdf", PDF());
	const res = await request.get(downloadUrl(w, submission, "nope.pdf"), {
		headers: { cookie: await sessionCookie(w.student.username) },
	});
	expect(res.status()).toBe(404);
});

test("R21: a file the submission cites but that was detached is 410", async ({
	request,
}) => {
	const w = await makeWorld();
	const { submission: old } = await putFile(w, w.pdf, "a.pdf", PDF());
	const { submission: current } = await putFile(w, w.pdf, "a.pdf", PDF());
	expect(current).not.toBe(old);
	const cookie = await sessionCookie(w.student.username);
	const gone = await request.get(downloadUrl(w, old, "a.pdf"), {
		headers: { cookie },
	});
	expect(gone.status()).toBe(410);
	const live = await request.get(downloadUrl(w, current, "a.pdf"), {
		headers: { cookie },
	});
	expect(live.status()).toBe(200);
});

test("R21: every response carries nosniff, no-referrer and private cache, and a sandbox CSP unless it is a PDF", async ({
	request,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	const pdf = await putFile(w, w.pdf, "a.pdf", PDF());
	const png = await putFile(w, w.pdf, "b.png", PNG());
	const html = await putFile(
		w,
		w.any,
		"page.html",
		Buffer.from(`<script>alert(${Math.random()})</script>`),
	);
	const cases = [
		{ submission: pdf.submission, name: "a.pdf", csp: false },
		{ submission: png.submission, name: "b.png", csp: true },
		{ submission: html.submission, name: "page.html", csp: true },
	];
	for (const { submission, name, csp } of cases) {
		const res = await request.get(downloadUrl(w, submission, name), {
			headers: { cookie },
		});
		expect(res.status(), name).toBe(200);
		const h = res.headers();
		expect(h["x-content-type-options"], name).toBe("nosniff");
		expect(h["referrer-policy"], name).toBe("no-referrer");
		expect(h["cache-control"], name).toContain("private");
		if (csp) {
			// Two policies, so the browser enforces both and the app's cannot loosen the route's.
			expect(h["content-security-policy"], name).toBe(
				`sandbox; default-src 'none', ${APP_CSP}`,
			);
		} else {
			expect(h["content-security-policy"], name).toBe(APP_CSP);
		}
	}
});

test("R21: PNG and PDF are served inline, an HTML upload as attachment", async ({
	request,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	const pdf = await putFile(w, w.pdf, "a.pdf", PDF());
	const png = await putFile(w, w.pdf, "b.png", PNG());
	const html = await putFile(
		w,
		w.any,
		"page.html",
		Buffer.from(`<h1>${Math.random()}</h1>`),
	);
	const disposition = async (submission: string, name: string) =>
		(
			await request.get(downloadUrl(w, submission, name), {
				headers: { cookie },
			})
		).headers()["content-disposition"] ?? "";
	expect(await disposition(pdf.submission, "a.pdf")).toMatch(/^inline/);
	expect(await disposition(png.submission, "b.png")).toMatch(/^inline/);
	expect(await disposition(html.submission, "page.html")).toMatch(
		/^attachment/,
	);
});

test("R20: nothing another student receives, header or body, contains the blob hash", async ({
	request,
}) => {
	const w = await makeWorld();
	const bytes = PDF();
	const hash = sha256(bytes);
	const { submission } = await putFile(w, w.pdf, "a.pdf", bytes);
	const res = await request.get(downloadUrl(w, submission, "a.pdf"), {
		headers: { cookie: await sessionCookie(w.other.username) },
	});
	expect(res.status()).toBe(404);
	expect(JSON.stringify(res.headers())).not.toContain(hash);
	expect((await res.body()).toString()).not.toContain(hash);
	// An unknown name and a made-up submission leak nothing either.
	for (const url of [
		downloadUrl(w, submission, "other.pdf"),
		downloadUrl(w, "no-such-submission", "a.pdf"),
	]) {
		const miss = await request.get(url, {
			headers: { cookie: await sessionCookie(w.other.username) },
		});
		expect(JSON.stringify(miss.headers())).not.toContain(hash);
		expect((await miss.body()).toString()).not.toContain(hash);
	}
});

test("R21: a PDF opens in the browser instead of being downloaded", async ({
	page,
	browserName,
}) => {
	// Headless Chromium has no PDF viewer and downloads every PDF; the inline
	// headers are checked on every engine by the test above.
	test.skip(
		browserName === "chromium",
		"headless Chromium downloads every PDF; run with TEST_BROWSERS=firefox",
	);
	const w = await makeWorld();
	const { submission } = await putFile(w, w.pdf, "a.pdf", PDF());
	await logInAs(page, w.student);
	let downloaded = false;
	page.on("download", () => {
		downloaded = true;
	});
	const response = await page
		.goto(downloadUrl(w, submission, "a.pdf"))
		.catch(() => null);
	await page.waitForTimeout(500);
	expect(downloaded).toBe(false);
	expect(response?.status()).toBe(200);
	expect(response?.headers()["content-disposition"] ?? "").toMatch(/^inline/);
	expect(response?.headers()["content-type"]).toContain("application/pdf");
});
