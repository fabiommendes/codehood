# Blobs and attachments

`File` is the only blob table and it is modelled as if `Resource` were its only
consumer. Question attachments (images, PDF handouts) are coming, so this spec
replaces `File` with a two-table split, folds uploads into the owning
resource's endpoint as `multipart/form-data`, and adds per-role storage quotas.

## The three defects being fixed

**`mimeType` sits on the blob but belongs to the use.** Bytes are
content-addressed and deduped, so one row is shared by every referrer.
`mimeType` is not derivable from the bytes, and today `FileService.update()`
lets one course mutate a row every other course points at. The filename is the
same defect, worse: the blob has no name, so `serveBlob` scavenges a *resource
title* (`fallbackFilename()`) to build `Content-Disposition`.

**Reference counting is hardcoded to `Resource`.** `FileService.delete()` reads
`_count.resources` and `findWithReferencingTitles()` selects `resources.title`.
Every new owner type means editing `FileService` again, and Prisma cannot count
"all relations" generically.

**`File` has two identities.** `id` autoincrement plus `slugHash` unique, so
`filePK` is a union and every read path branches on it. The hash is the real
identity and the only one the URL, the disk path and the CLI use.

## Scope

- `File` -> `Blob` (pure content, `hash` as PK) + `Attachment` (one row per
  use-site, carrying `filename`, `mimeType`, uploader and polymorphic owner).
- `BlobService` and `AttachmentService` in `src/db/services/`, full CRUD per
  `docs/design/db-service-classes.md`. Neither is routed.
- `POST /api/course/<discipline>/<instructor>_<edition>/resource` accepts `application/json` and `multipart/form-data`
  from the same operation; the multipart branch carries the bytes.
- Per-role quotas from env vars, plus `AttachmentService.usageBytes(username)`.
- `BlobService.collectGarbage()` and a `manage gc-blobs` command.
- `src/utils/mime.ts` and `sanitiseFilename()`: the derivation and validation
  applied to every attachment before it reaches disk or a URL.
- A per-blob directory holding the bytes plus one link per attachment
  filename, so the proxy needs no mime configuration from us.
- SHA-256 pinned and documented as part of the CLI wire contract.
- `config/caddy/`, `config/nginx/` example configs for serving blobs statically,
  both optional: the app serves the same URLs with no proxy in front of it.

Out of scope: per-account and per-course quotas (the schema supports them with
no further migration); question attachments themselves, which only need
`ownerType: "QUESTION"` once `QuestionService` wants them; rate limiting.

## Design decisions

### Blob is anonymous, Attachment is the ledger

Both "who is charged for these bytes" and "what still points at them" are
answered by the same table. That is the signal the split is in the right place.

```prisma
model Blob {
  /// sha-256 of the bytes. Identity, URL token and disk path, all one value.
  hash String @id

  size Int

  /// Set when the bytes are removed from disk; the row survives as a
  /// tombstone so the URL can explain itself instead of 404ing
  /// (FR-SYNC-013, FR-SYNC-015).
  deletedAt DateTime?

  createdAt   DateTime     @default(now())
  attachments Attachment[]
}

model Attachment {
  id   Int    @id @default(autoincrement())
  hash String
  blob Blob   @relation(fields: [hash], references: [hash])

  /// Drives Content-Disposition and the trailing URL segment.
  filename String

  /// Per use-site, never per bytes.
  mimeType String

  /// Charged for these bytes. Nullable so deleting a user does not delete the
  /// course material they uploaded; the quota charge leaves with them.
  uploaderUsername String?
  uploader         User?   @relation(fields: [uploaderUsername], references: [username], onDelete: SetNull)

  ownerType AttachmentOwner
  ownerId   Int

  createdAt DateTime @default(now())

  @@index([ownerType, ownerId])
  @@index([hash])
  @@index([uploaderUsername])
}

enum AttachmentOwner {
  RESOURCE
  QUESTION
}
```

No `firstUploaderId` on `Blob`: it is the oldest attachment's uploader.

### Ownership is polymorphic, and that costs one stitch query

A nullable FK per owner type (`resourceId?`, `questionId?`) keeps database-level
integrity but grows a column per owner and re-introduces the per-owner branching
this spec exists to delete. `ownerType`/`ownerId` keeps one table, one delete
path and one GC query forever.

The price: no Prisma relation from `Resource` to its attachment, so reads
stitch. `AttachmentService.forOwners(type, ids)` returns a
`Map<number, Attachment[]>` and `ResourceService` joins in memory. The price
paid back: deleting an owner is `attachmentService.detachOwner(type, id)` in the
same transaction, identical for every owner type.

Because SQLite cannot cascade a polymorphic reference, **every owner service
must detach in its own `delete`**. A missed call leaks an attachment; GC will
not collect it, since the row still exists. This is the one invariant worth a
test per owner type.

### Deletion is detach plus sweep, not reference counting

`blob.delete()` no longer counts referrers. Owner services detach; a blob whose
last attachment is gone becomes collectable, and `BlobService.collectGarbage()`
tombstones blobs with zero attachments older than a grace period (default 24h,
to survive a half-finished sync). Cheaper to reason about than a refcount
spread across N owner tables, and it self-heals after a crash.

There is no upload endpoint that leaves a blob unattached (see below), so an
orphan is always the result of a deletion, never of an abandoned upload.

### Upload is attach-in-one-request

The attachment is created in the same transaction as its owner, so there is no
staged state, no `expiresAt`, and no window where uploaded bytes belong to
nobody. There are no public `Blob` or `Attachment` endpoints at all: the REST
API only exposes the higher-level resource, which calls both services inside one
`tx`.

### One endpoint, two media types

`requestBody.content` in OpenAPI 3.x is a map of media type to schema, so a
single operation legitimately documents both. Swagger UI renders a media-type
dropdown. `POST /api/course/<discipline>/<instructor>_<edition>/resource` therefore keeps one `operationId` and branches on
`Content-Type`:

```
POST /api/course/cs101/ada_2026-1/resource
Content-Type: multipart/form-data; boundary=----abc

------abc
Content-Disposition: form-data; name="slug"

week1-handout
------abc
Content-Disposition: form-data; name="title"

Week 1 handout
------abc
Content-Disposition: form-data; name="type"

FILE
------abc
Content-Disposition: form-data; name="data"; filename="handout.pdf"
Content-Type: application/pdf

<raw bytes>
------abc--
```

Parts are flat, one per field, rather than a single JSON metadata part plus the
bytes. Flat is what every client, every `curl -F` example and every OpenAPI
generator assumes; a JSON part needs an `encoding` block that Swagger UI renders
as a raw textarea. Revisit only if the metadata grows a nested object.

`data` carries the payload for every resource type: a URL for `LINK`, the text
for `MD` and `CODE`, the bytes for `FILE`. The service schema widens to
`data: z.union([z.string(), z.instanceof(Buffer)]).nullable()`; the JSON request
schema keeps `data: string | null`, and the multipart schema declares
`data` as `{ type: string, format: binary }` plus the `filename` and `mimeType`
parts that only a `FILE` needs. Bytes never travel as base64 again.

### Registry changes

`RouteOptions` gains `inMultipart?: ZodType`. When present, `route()` registers
a second entry under `multipart/form-data` in `request.body.content`, and
`result.view` branches:

```ts
const contentType = request.headers.get("content-type") ?? "";
const raw = contentType.startsWith("multipart/form-data")
  ? await readMultipart(request, options.inMultipart)
  : await request.json();
```

`readMultipart` calls `request.formData()`, turns the `File` parts into
`Buffer`s and passes the string parts through `coerceForSchema` -- the same
coercion `collectSearchParams` already needs, for the same reason: every
non-file part arrives as a string.

`request.formData()` buffers the whole body in memory. Cap it by rejecting a
`Content-Length` above the uploader's remaining quota before reading the body.

### Quotas are global, per role, from env

```
BLOB_QUOTA_STUDENT     default "200mb"
BLOB_QUOTA_INSTRUCTOR  default "1gb"
```

`ADMIN` is unlimited and has no variable. Values parse with a size suffix
(`kb`/`mb`/`gb`, case-insensitive, decimal multiples) into bytes, in
`src/core/constants.ts` next to `RESOURCE_ROOT`, and are logged with the rest.

Usage is `SUM(blob.size)` over the user's attachments, exposed as
`AttachmentService.usageBytes(username): Promise<number>`. It is charged **per
attachment, not per distinct byte on disk**: dedupe means the server's real disk
cost is below the sum of everyone's charges, which is the asymmetry we want.
Charging disk bytes would make the second uploader of a shared file pay nothing.

`usageBytes` is public and stays public even where nothing enforces yet -- it is
what a future per-course or per-account rule is built on, and what the profile
page will show.

### One directory per blob, one link per filename

```
<RESOURCE_ROOT>/<hash[0:2]>/<hash>/<hash>      the bytes, canonical entry
<RESOURCE_ROOT>/<hash[0:2]>/<hash>/<filename>  one per distinct attachment name
```

`/files/<hash>/<filename>` maps to a real path with a real extension, so the
reverse proxy derives `Content-Type` from its own table and Codehood ships no
mime map at all. That deletes the `map` blocks, the drift test between them and
the app, the hand-rolled inline-vs-download tiering, and the question of how
exhaustive our extension table has to be: nginx ships ~90 types and Caddy reads
the system table, so `mp4`, `webm`, `mp3`, `ogg`, `wasm`, `dwg` and every other
format arrive correct without us enumerating anything.

`Content-Disposition` is dropped entirely. Without it the browser picks
inline-vs-download from the type and takes the download name from the URL's
last segment, which is already the filename. Keeping it would duplicate what
the URL says and re-impose the inline/download call we would rather leave to
the type. `fallbackFilename()` goes with it.

The one type no system table knows is `.mdq`. Caddy overrides it in two lines;
nginx needs a line in the operator's `mime.types`, since a `types` block in a
location replaces the inherited table instead of extending it. Both are
documented in `config/`.

The trade is that the proxy's table, not ours, is authoritative on the static
path, and Go reads `/etc/mime.types`, which varies by image. For common types
every deployment agrees; for exotic ones two may differ. `mimeType` is still
derived and stored for the app's own path, and the divergence is accepted.

### Links are symlinks, hardlinks or copies, by env

```
ATTACHMENT_LINK_MODE  symlink (default) | hardlink | copy
```

One branch in `BlobService.link()`; the modes are otherwise indistinguishable
to every reader. Symlinks are the default because they are self-documenting --
`ls -l` shows which hash a name resolves to, and a broken one is visible --
but they need symlink following, which hardened nginx (`disable_symlinks on`)
turns off. Hardlinks work without privileges on Windows and cost no extra
inode content; copies exist for filesystems that support neither, at the cost
of storing the bytes once per distinct filename.

### Filenames are sanitised before they touch disk or a URL

`filename` is now a path component and it comes from the client, so it is
validated, not trusted. `sanitiseFilename()` in `src/utils/` takes the basename,
rejects `/`, `\`, NUL, `.` and `..`, strips leading dots, NFC-normalises,
slugifies the stem while preserving a validated extension, and caps the result
at 255 **bytes** rather than characters.

The sanitised name is what gets stored, what the symlink is named, and what the
URL contains -- one spelling, no round-trip surprise. **The create response
returns it**, so a client that sent `Week 1 Notes.PDF` learns it must address
`week-1-notes.pdf` from then on.

Names are scoped per blob directory, so there is no global namespace to
collide in. Two attachments with the same blob *and* the same sanitised name
share one link: removal counts siblings
(`attachments where hash = ? and filename = ?`) before unlinking. The same name
on different bytes lands in a different directory and never interacts.

### No proxy is required; the app serves blobs itself

`/files/[hash]/[name].ts` already answers the same URLs the proxy answers, so a
dev checkout and a small deployment work with nothing in front of them. The
proxy is an optimisation that keeps blob bytes out of the Node process, not a
dependency, and `config/` says so.

That makes the fall-through mandatory rather than a nicety: a blob missing from
disk must reach the app, or a tombstoned file becomes indistinguishable from a
wrong hash and the 410 page never renders. Caddy: `file_server { pass_thru }`.
Nginx: `try_files "" @app`.

`serveBlob` looks the attachment up by hash and filename and answers from its
stored `mimeType`. It has no filesystem-only mode: a blob with no row in the
database is not served, in dev or anywhere else. Keeping `RESOURCE_ROOT`
consistent with the database is the operator's job.

### The extension decides the mime type

`src/utils/mime.ts` owns `MIME_BY_EXTENSION`, used when the app serves a blob
itself and when an attachment is created. It no longer has to agree with any
proxy config, so it only needs the types Codehood cares about naming.

On attachment create, the extension wins:

- Extension present and known -> `mimeType` is **derived from it**, and any
  value the client supplied is discarded, not rejected. `notes.txt` declared as
  `application/pdf` is stored as `text/plain`.
- Extension absent or unknown -> the client's `mimeType` is kept, falling back
  to `application/octet-stream` when it is missing too.

Refusing a mismatch would fail uploads over a detail the server can silently
fix and that no caller can always get right. Overwriting also keeps the stored
type close to what the proxy will independently conclude from the same
extension.

`.md` and `.mdq` both store `text/markdown`, so the extension does not
round-trip through the mime type; anything needing to know a file was
specifically `.mdq` reads `filename`.

### Hashing is SHA-256, lowercase hex

The CLI computes the hash locally to decide what to upload and to detect a
corrupt transfer, so the algorithm is part of the wire contract and belongs in
the docs, not in one implementation's head.

**Definition.** `hash = lowercase_hex(sha256(bytes))`, 64 characters. The
digest covers the raw file bytes and nothing else: no filename, no length
prefix, no framing. Chunked and one-shot hashing must agree, and the empty
file is legal (`e3b0c442...`).

```python
hashlib.sha256(data).hexdigest()                        # stdlib
```
```ts
createHash("sha256").update(bytes).digest("hex");       // node:crypto
```

**Why SHA-256.** It is the only candidate with a zero-dependency
implementation in the Python standard library, in Node, *and* in Web Crypto
(`crypto.subtle.digest("SHA-256")`), which matters the day anything hashes in
a browser. It is hardware-accelerated on every current x86 (SHA-NI) and ARMv8
target, putting it around 1-2 GB/s -- far above the disk and network that
actually bound a course-material upload.

**Why not the faster options.** BLAKE3 is several times quicker but needs a
third-party package in both languages. BLAKE2b is in Python's stdlib and in
Node via OpenSSL, but has no Web Crypto implementation. Non-cryptographic
hashes (xxHash, CRC) are disqualified on principle rather than on speed: the
hash *is* the capability that grants access to a blob (FR-NFR-030), so it must
be collision- and preimage-resistant whatever the performance argument.

**Why hex and not base64url.** Base64url would be 43 characters instead of 64,
but it is case-sensitive, and the hash is a directory name on filesystems that
may be case-insensitive. Hex has no case to lose.

### Authorization is unchanged

The hash is the capability (FR-NFR-030/032): knowing it is what grants access,
nothing whose disclosure matters belongs in a blob, and the routes stay
unauthenticated. Uploads remain gated at the owning endpoint, which is where the
actor is already known.

## Migration

1. Create `Blob` from `File`: `hash = slugHash`, `size`, `deletedAt`,
   `createdAt`.
2. Create one `Attachment` per `Resource` with a non-null `fileId`:
   `mimeType` from the old `File`, `filename` from `slugify(resource.title)`
   plus an extension guessed from the mime type, `uploaderUsername = null`,
   `ownerType = RESOURCE`, `ownerId = resource.id`.
3. Move every blob on disk from `<hash[0:2]>/<hash>` to
   `<hash[0:2]>/<hash>/<hash>` and create the link for each attachment's
   sanitised filename. A `manage relayout-blobs` command does this and is
   idempotent, so it can be re-run after a partial failure.
4. Drop `Resource.fileId` and `File`.

Blobs with no referring resource carry over as `Blob` rows with no attachment
and are collected on the first GC sweep after the grace period.

The CLI has not implemented any file interaction yet, so there is no wire
compatibility to keep: `fileId` simply leaves the resource payload.

## Removals

- `fileApi` in `src/api/index.ts` and `fileCreate`/`fileUpdate`/`filePK`/
  `fileFilter` from the public surface.
- `FileService`, `fallbackFilename()`, `findWithReferencingTitles()`.
- The base64/JSON bytes path in `fileCreate`.

## Tests

- Dedupe: two attachments, different filenames and mime types, one `Blob`, one
  file on disk, both download under their own name.
- `contentHash` mismatch rejects the upload and writes nothing.
- Detach invariant: deleting a resource leaves zero attachments for it; the
  blob survives until GC, then tombstones and the URL answers 410.
- A blob still attached elsewhere is never collected.
- Quota: an upload that would exceed the role's limit is refused before the
  body is read; `usageBytes` matches the sum of the user's attachments and is
  unaffected by another user uploading identical bytes.
- Multipart and JSON both create an equivalent resource through the same
  endpoint, and the generated OpenAPI document lists both media types for it.
- Mime derivation: `notes.txt` uploaded as `application/pdf` is stored and
  served as `text/plain`; `handout.mdq` becomes `text/markdown`; `part.dwg`
  keeps whatever the client declared; a name with no extension and no declared
  type becomes `application/octet-stream`.
- Sanitation: `../../etc/passwd`, `a/b.png`, a 300-byte name, a name that is
  only dots, and a NUL byte are each rejected or reduced to a safe basename,
  and the create response echoes the name the client must use afterwards.
- Link modes: all three `ATTACHMENT_LINK_MODE` values produce a readable file
  at the attachment's path, and removing one of two attachments sharing a name
  leaves the survivor readable.
- Hashing: a fixture's SHA-256 matches a hex digest pinned in the test, the
  empty file hashes to `e3b0c442...`, and chunked hashing equals one-shot.
- `serveBlob` returns the attachment's own `filename` and `mimeType` with no
  proxy present, matching what the `config/` maps would have produced.
