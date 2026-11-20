import http from "node:http";
import { MAX_UPLOAD_BYTES } from "@/core/schemas/blob";
import { prisma } from "@/db/client";
import { expect, test } from "./fixtures";
import {
	fresh,
	makeWorld,
	putFile,
	sessionCookie,
	sha256,
	type World,
} from "./response-files-world";

/// Sending and removing the files of an upload answer over REST (R22).

function fileUrl(w: World, question: { slug: string }, name?: string) {
	const base = `${w.examBase}/question/${question.slug}/file`;
	return name === undefined ? base : `${base}/${encodeURIComponent(name)}`;
}

function form(name: string, bytes: Buffer) {
	return {
		name,
		file: { name: "blob", mimeType: "application/octet-stream", buffer: bytes },
	};
}

function blobCount(hash: string) {
	return prisma.blob.count({ where: { hash } });
}

type Listed = { files: { name: string; path: string; size: number }[] | null };

test("R22: a session cookie alone sends a file and the answer lists it with the submission id", async ({
	request,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	const bytes = fresh(2000, "%PDF-1.4 ");
	const res = await request.post(fileUrl(w, w.pdf), {
		headers: { cookie },
		multipart: form("Relatório Final.pdf", bytes),
	});
	expect(res.status()).toBe(200);
	const body = (await res.json()) as Listed & { submission: string };
	expect(body.files).toHaveLength(1);
	expect(body.files?.[0]).toMatchObject({ size: 2000, path: sha256(bytes) });
	expect(body.files?.[0]?.name.toLowerCase().endsWith(".pdf")).toBe(true);
	expect(typeof body.submission).toBe("string");
	expect(await blobCount(sha256(bytes))).toBe(1);
});

test("R22: a cross-site Origin without a Bearer key is refused with 403 and stores nothing", async ({
	request,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	const bytes = fresh(500, "%PDF-1.4 ");
	const res = await request.post(fileUrl(w, w.pdf), {
		headers: { cookie, origin: "https://evil.example" },
		multipart: form("a.pdf", bytes),
	});
	expect(res.status()).toBe(403);
	expect(await blobCount(sha256(bytes))).toBe(0);
});

test("R22: without a session the route answers 401", async ({ request }) => {
	const w = await makeWorld();
	const res = await request.post(fileUrl(w, w.pdf), {
		headers: { cookie: "" },
		multipart: form("a.pdf", fresh(500)),
	});
	expect(res.status()).toBe(401);
});

test("R22: DELETE removes a file by its stored name and answers the new list", async ({
	request,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	await putFile(w, w.pdf, "a.pdf", fresh(100, "%PDF"));
	const { files } = await putFile(w, w.pdf, "b.pdf", fresh(100, "%PDF"));
	expect(files).toHaveLength(2);
	const res = await request.delete(fileUrl(w, w.pdf, "a.pdf"), {
		headers: { cookie },
	});
	expect(res.status()).toBe(200);
	const body = (await res.json()) as Listed & { submission: string };
	expect(body.files?.map((f) => f.name)).toEqual(["b.pdf"]);
	expect(typeof body.submission).toBe("string");
});

test("R22: DELETE of an unknown name is 404", async ({ request }) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	await putFile(w, w.pdf, "a.pdf", fresh(100, "%PDF"));
	const res = await request.delete(fileUrl(w, w.pdf, "nope.pdf"), {
		headers: { cookie },
	});
	expect(res.status()).toBe(404);
});

test("R22: a body over MAX_UPLOAD_BYTES is refused with 413 and nothing is stored", async ({
	request,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	const bytes = fresh(MAX_UPLOAD_BYTES + 1024, "%PDF-1.4 ");
	const res = await request.post(fileUrl(w, w.pdf), {
		headers: { cookie },
		multipart: form("big.pdf", bytes),
	});
	expect(res.status()).toBe(413);
	expect(await blobCount(sha256(bytes))).toBe(0);
	const rows = await prisma.attachment.count({
		where: { attachedToType: "RESPONSE", attachedToId: w.attempt.id },
	});
	expect(rows).toBe(0);
});

test("R22: a refusal of the service surfaces as its status with the reason in the body", async ({
	request,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	const res = await request.post(fileUrl(w, w.pdf), {
		headers: { cookie },
		multipart: form("virus.exe", fresh(100)),
	});
	expect(res.status()).toBe(400);
	const body = await res.json();
	expect(body.type).toBe("error");
	expect(String(body.message).length).toBeGreaterThan(0);
	// the question takes 3 files of 20 MB; the small one takes 1 KB
	const tooBig = await request.post(fileUrl(w, w.small), {
		headers: { cookie },
		multipart: form("a.pdf", fresh(5000, "%PDF")),
	});
	expect(tooBig.status()).toBe(400);
});

/// Opens a request whose body stays half sent, holding an upload slot until `finish`.
function slowUpload(
	baseURL: string,
	path: string,
	cookie: string,
	name: string,
	bytes: Buffer,
) {
	const boundary = `----slow${Math.random().toString(36).slice(2)}`;
	const head = Buffer.from(
		`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n` +
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\n` +
			"Content-Type: application/octet-stream\r\n\r\n",
	);
	const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
	const total = head.length + bytes.length + tail.length;
	const url = new URL(path, baseURL);
	let resolve!: (r: { status: number; body: string }) => void;
	const done = new Promise<{ status: number; body: string }>((r) => {
		resolve = r;
	});
	const req = http.request(
		url,
		{
			method: "POST",
			headers: {
				cookie,
				origin: new URL(baseURL).origin,
				"content-type": `multipart/form-data; boundary=${boundary}`,
				"content-length": String(total),
			},
		},
		(res) => {
			const chunks: Buffer[] = [];
			res.on("data", (c) => chunks.push(c));
			res.on("end", () =>
				resolve({
					status: res.statusCode ?? 0,
					body: Buffer.concat(chunks).toString(),
				}),
			);
		},
	);
	req.on("error", () => resolve({ status: 0, body: "" }));
	const half = Math.floor(bytes.length / 2);
	req.write(Buffer.concat([head, bytes.subarray(0, half)]));
	return {
		done,
		finish() {
			req.write(Buffer.concat([bytes.subarray(half), tail]));
			req.end();
		},
	};
}

test("R22: more than 2 uploads at once by one user get 429, and the ones that held a slot are stored", async ({
	request,
	baseURL,
}) => {
	const w = await makeWorld();
	const cookie = await sessionCookie(w.student.username);
	const url = baseURL as string;
	const a = fresh(4000, "%PDF-a ");
	const b = fresh(4000, "%PDF-b ");
	const slowA = slowUpload(url, fileUrl(w, w.pdf), cookie, "a.pdf", a);
	const slowB = slowUpload(url, fileUrl(w, w.pdf), cookie, "b.pdf", b);
	// Let both reach the server and take their slots before the third arrives.
	await new Promise((r) => setTimeout(r, 750));
	const third = await request.post(fileUrl(w, w.pdf), {
		headers: { cookie },
		multipart: form("c.pdf", fresh(100, "%PDF-c ")),
	});
	expect(third.status()).toBe(429);
	slowA.finish();
	slowB.finish();
	const [ra, rb] = await Promise.all([slowA.done, slowB.done]);
	// Both held a slot, so neither was refused for the slots.
	expect([ra.status, rb.status].filter((s) => s === 429)).toHaveLength(0);
	const ok = [ra, rb].filter((r) => r.status === 200);
	expect(ok.length).toBeGreaterThan(0);
	// The list after the concurrent writes has every upload that answered 200.
	const stored = await prisma.blob.count({
		where: { hash: { in: [sha256(a), sha256(b)] } },
	});
	expect(stored).toBe(ok.length);
});
