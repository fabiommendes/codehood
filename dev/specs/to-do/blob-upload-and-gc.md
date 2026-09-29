---
type: spec
status: to-do
tags: [blobs, attachments, api, upload]
relatedTo: [resource-service, blob-service]
---

# Blob upload over REST, content hash and GC commands

Split out of the blobs-and-attachments spec. `Blob`, `Attachment`, hashing,
filename sanitising, link modes, quotas and GC as a service are implemented.
What is left is below.

## Multipart upload

FILE resources cannot be created over REST today: `resourceFileDataCreate`
requires a `Buffer`, and the resource POST reads JSON only.

- `POST /api/course/<discipline>/<instructor>_<edition>/resource` keeps one
  `operationId` and branches on `Content-Type`: JSON as today, or
  `multipart/form-data` with one flat part per field and the bytes in `data`.
- `RouteOptions` gains `inMultipart?: ZodType`. When set, `route()` registers a
  second media type in `requestBody.content`, and the handler reads the body
  with `readMultipart`: `request.formData()`, `File` parts to `Buffer`, string
  parts through `coerceForSchema`.
- `request.formData()` buffers the whole body. Reject a `Content-Length` above
  the uploader's remaining quota before reading it.
- PUT (upsert) accepts the same two media types.

## Content hash

- `blobCreate` and the FILE resource input gain an optional `contentHash`
  (lowercase hex SHA-256). A mismatch refuses the upload and writes nothing.
- The CLI sends it; the server never requires it.

## Commands

- `manage gc-blobs`: runs the sweep the service already implements, with the
  grace period from env.
- `manage relayout-blobs` only if blobs from the old `<hash[0:2]>/<hash>`
  layout still exist anywhere. Otherwise drop it.

## Divergences to settle

The implementation departs from the original spec here. Each one needs a
decision: keep and document, or change the code.

- The client's declared mime type is dropped: `part.dwg` always becomes
  `application/octet-stream`. The spec kept the declared type for unknown
  extensions.
- `serve` sets `Content-Disposition` with an inline/download split. The spec
  said no disposition.
- `serve` picks the mime type from any attachment with that hash, not by hash
  and filename. With the same bytes stored as `notes.txt` and `notes.md`,
  `/files/<h>/notes.md` can come back as `text/plain`, and any trailing name
  returns 200. This one is a bug.
- Deleting the last attachment tombstones the blob at once, instead of leaving
  it for GC after the grace period.
- `Resource.attachmentId` is a real foreign key, not the polymorphic stitch
  the spec described. Fine, but no owner service calls `detach`.

## Tests

- Multipart and JSON create an equivalent resource through the same endpoint;
  the OpenAPI document lists both media types.
- A `Content-Length` over the remaining quota is refused before the body is
  read.
- A wrong `contentHash` refuses the upload and writes nothing.
- A deleted blob answers 410 through its URL.
- Two attachments with the same bytes and different extensions are each served
  with their own mime type.
