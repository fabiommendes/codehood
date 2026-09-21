# Handoff: blob storage foundation (cycle 1)

Implements the storage half of `dev/specs/to-do/blob-attachments.md`. Read that
spec first: it carries the rationale this document does not repeat.

**Cycle 1 is storage only.** No HTTP, no multipart, no migration off `File`.
`File`/`FileService`/`fileApi` stay exactly as they are and keep working; the
new tables live beside them. Cycle 2 does the endpoint, `serveBlob`, the
`Resource` migration and the removal.

## Goal

Two tables replacing one. `Blob` is anonymous, deduped content addressed by the
sha-256 of its own bytes. `Attachment` is the ledger: one row per use of a blob
by one owner, carrying the `filename` and `mimeType` that use is served under
and the user charged for the bytes. Reference counting, garbage collection and
quotas all become one query over `Attachment`.

## Already in place

The orchestrator has landed the schema, the Zod schemas, the constants and
stubs. Neither agent needs to design these.

- `prisma/schema.prisma`: `Blob`, `Attachment`, `AttachmentOwner`, plus
  `User.attachments`. Client regenerated. `test/run.ts` pushes it automatically.
- `src/core/schemas.ts`: `blobHash`, `blobSchema`, `blobCreate`, `blobPK`,
  `blobFilter`, `attachmentSchema`, `attachmentCreate`, `attachmentUpdate`,
  `attachmentPK`, `attachmentFilter`, `attachmentOwnerSchema`, `AttachmentId`.
- `src/core/constants.ts`: `ATTACHMENT_LINK_MODE`, `BLOB_QUOTA_BY_ROLE`,
  `BLOB_GC_GRACE_MS`.
- Stubs, every method throwing `not implemented`: `src/utils/content-hash.ts`,
  `src/utils/filename.ts`, `src/utils/mime.ts` (new exports only — the existing
  `guessMimeType`/`extensionForMime` are real and must keep working),
  `src/utils/format-bytes.ts` (`parseByteSize`), `src/db/services/blob.service.ts`,
  `src/db/services/attachment.service.ts`.
- `fast-check` added as a dev dependency.

## Public API

Signatures are fixed. Changing one needs orchestrator approval.

```ts
// src/utils/content-hash.ts
hashBytes(bytes: Buffer): string          // 64 lowercase hex, sha-256 of the raw bytes
isBlobHash(hash: string): boolean

// src/utils/filename.ts
sanitizeFilename(name: string): string    // throws InvalidData on structural violations

// src/utils/mime.ts
MIME_BY_EXTENSION: Record<string, string> // keys lowercase, leading dot
extensionOf(filename: string): string | null
mimeFor(filename: string, declared?: string | null): string

// src/utils/format-bytes.ts
parseByteSize(value: string): number      // inverse of formatBytes, binary multiples

// src/db/services/blob.service.ts
class BlobService {
  constructor(client?: PrismaClient, options?: { root?: string; linkMode?: AttachmentLinkMode })
  create(input: BlobCreate, opts: ServiceOpts): Promise<Blob>
  findOne(filter: BlobPK, opts?: ServiceOpts): Promise<Blob | null>
  findMany(filter: BlobFilter, opts?: ServiceOpts): Promise<Blob[]>
  delete(filter: BlobPK, opts: ServiceOpts): Promise<void>
  collectGarbage(opts: ServiceOpts & { olderThan?: Date }): Promise<string[]>
  link(hash: string, filename: string): Promise<void>
  unlink(hash: string, filename: string): Promise<void>
  readBlob(blob: Pick<Blob, "hash" | "deletedAt">): Promise<Buffer | null>
  blobDir(hash): string; blobPath(hash): string; attachmentPath(hash, filename): string
}

// src/db/services/attachment.service.ts
class AttachmentService {
  constructor(client?: PrismaClient, blobs?: BlobService)
  create(input: AttachmentCreate, opts: ServiceOpts): Promise<Attachment>
  findOne(filter: AttachmentPK, opts?: ServiceOpts): Promise<Attachment | null>
  findMany(filter: AttachmentFilter, opts?: ServiceOpts): Promise<Attachment[]>
  update(filter: AttachmentPK, fields: AttachmentUpdate, opts: ServiceOpts): Promise<Attachment>
  delete(filter: AttachmentPK, opts: ServiceOpts): Promise<void>
  detachOwner(ownerType: AttachmentOwner, ownerId: number, opts: ServiceOpts): Promise<number>
  forOwners(ownerType: AttachmentOwner, ownerIds: number[], opts?: ServiceOpts): Promise<Map<number, Attachment[]>>
  usageBytes(username: string, opts?: ServiceOpts): Promise<number>
  quotaFor(role: Role): number | null
  assertWithinQuota(additionalBytes: number, opts: ServiceOpts): Promise<void>
}
```

## Behaviour contract

The three agents must agree on these without reading each other's code.

### `hashBytes`

Lowercase hex sha-256 of the raw bytes, nothing else: no filename, no length
prefix, no framing. Empty buffer is legal (`e3b0c442...`). Chunked and one-shot
hashing agree, because both are plain sha-256.

### `sanitizeFilename`

**Throws `InvalidData`** on structural violations, which a caller should never
send and which cannot be repaired safely:

- empty or whitespace-only input
- a NUL byte anywhere
- a path separator: `/` or `\`
- a basename that is `.` or `..`, or that is only dots
- a result that is exactly 64 lowercase hex characters, which would collide
  with the blob's own canonical entry in its directory

**Normalises silently** everything else, and the create response echoes the
result so the caller learns the name it must use afterwards:

- NFC-normalise, then split the last `.` into stem and extension
- an extension counts only if it is 1..16 characters and alphanumeric after
  lowercasing; otherwise the whole name is the stem
- the stem goes through the existing `slugify()`; an empty result becomes
  `file`
- the extension is lowercased and re-appended
- truncate the **stem** until the whole name fits 255 **bytes** in UTF-8; the
  extension is never truncated

Invariants, which the tester should lean on:

- the result matches `/^[a-z0-9][a-z0-9.-]*$/`
- it contains no path separator and no leading dot
- `Buffer.byteLength(result) <= 255`
- **idempotent**: `sanitizeFilename(sanitizeFilename(x)) === sanitizeFilename(x)`
  for every `x` that does not throw

### `mimeFor` and `extensionOf`

- `extensionOf("a.PDF")` is `".pdf"`; no dot, a trailing dot, or a leading dot
  with nothing after it gives `null`
- known extension wins outright: `mimeFor("notes.txt", "application/pdf")` is
  `"text/plain"`
- unknown or absent extension keeps `declared`
- neither available gives `"application/octet-stream"`
- `.md` and `.mdq` both give `"text/markdown"`

### `parseByteSize`

- `"200mb"`, `"200MB"`, `"200 mb"` and `"209715200"` all give `209715200`
- binary multiples, so it round-trips `formatBytes`: `parseByteSize(formatBytes(n))`
  is within one rounding step of `n`
- suffixes `b`, `kb`, `mb`, `gb`; a bare number is already bytes
- throws on anything else, including negatives and `"12xb"`

### `BlobService`

- `create` hashes the bytes; a `contentHash` that disagrees throws (corrupt
  upload) and writes nothing
- identical bytes return the existing row untouched, writing the file once
- bytes whose blob is tombstoned resurrect it: `deletedAt` clears and the file
  is rewritten
- creation is `SYSTEM`-only, exactly as `FileService.create` is today
  (`opts.actor !== SYSTEM` throws `NotAllowed`). Cycle 2 decides the real rule
  once there is an endpoint with a user behind it. `delete` and
  `collectGarbage` are `SYSTEM`-only too.
- disk layout is `<root>/<hash[0:2]>/<hash>/<hash>` for the bytes and
  `<root>/<hash[0:2]>/<hash>/<filename>` for each attachment name
- `link` honours `linkMode`: `symlink` makes a **relative** symlink pointing at
  the bare hash, `hardlink` a hard link, `copy` a copy. Idempotent.
- `unlink` on a missing name is a no-op, never an error
- `delete` is a no-op while any attachment points at the blob; otherwise it
  removes the whole blob directory and stamps `deletedAt`
- `collectGarbage` tombstones every blob with no attachment and
  `createdAt < olderThan` (default `now - BLOB_GC_GRACE_MS`), returning the
  hashes it collected, and never touches an attached blob
- `readBlob` returns `null` for a tombstoned blob and for bytes missing on disk

### `AttachmentService`

- `create` runs in one transaction: sanitise the filename, derive the mime
  type, check the quota, upsert the blob, link the name, insert the row
- the returned `filename` is the sanitised one
- two attachments sharing a blob and a sanitised name share one link;
  `delete` unlinks only once the last of them is gone
- `update` renames: link the new name, unlink the old when no sibling holds it
- `detachOwner` deletes every attachment of that owner and returns the count
- `forOwners` returns a `Map` keyed by owner id, absent ids simply missing
- `usageBytes` sums `blob.size` over that user's attachments; a second user
  uploading identical bytes does not change the first user's number
- `quotaFor` reads `BLOB_QUOTA_BY_ROLE`; `SYSTEM` and `ADMIN` are unlimited
- `assertWithinQuota` throws `NotAllowed` when usage plus `additionalBytes`
  would exceed the quota

## Testing strategy

- **Property-based** (`fast-check`) for the pure utilities: `sanitizeFilename`'s
  four invariants against arbitrary unicode strings, `hashBytes` against
  `node:crypto` as the reference oracle and for chunk-independence,
  `parseByteSize`/`formatBytes` round-trip.
- **Table-driven** for `mimeFor`, `extensionOf` and `parseByteSize`'s named
  cases, and for `sanitizeFilename`'s throwing cases. One test, one table.
- **Imperative, against the real filesystem and the test database**, for the
  two services: they are side-effect-heavy by nature and mocking the filesystem
  would test the mock. Inject a temp `root` per test via `new BlobService(prisma,
  { root })` rather than touching `RESOURCE_ROOT`, and run the link-mode matrix
  by constructing one service per mode.
- One happy-path test may assert many properties at once. Edge cases get
  their own focused tests.
- Fixtures: `src/fixtures/blob.factory.ts` and `attachment.factory.ts`,
  following `file.factory.ts`. The tester owns these.
- Files: `test/blob-service.spec.ts`, `test/attachment-service.spec.ts`,
  `test/filename.spec.ts`, `test/mime.spec.ts`. Leave `test/file-service.spec.ts`
  alone; it covers code cycle 1 does not touch.

## Acceptance criteria

1. Two attachments with different filenames over identical bytes produce one
   `Blob` row, one copy of the bytes, and two working names in the directory.
2. A corrupt `contentHash` is refused and leaves nothing on disk.
3. `sanitizeFilename` never returns a path, never exceeds 255 bytes, and is
   idempotent; the listed structural violations throw.
4. Every `ATTACHMENT_LINK_MODE` produces a readable file at the attachment's
   path, and removing one of two attachments sharing a name leaves the other
   readable.
5. Detaching the last attachment makes a blob collectable; `collectGarbage`
   tombstones it and never touches an attached one.
6. `usageBytes` matches the sum of a user's attachments and is unmoved by
   another user uploading the same bytes; `assertWithinQuota` throws at the
   limit and admins are unlimited.
7. `pnpm run lint` exits 0 and the full suite passes.
