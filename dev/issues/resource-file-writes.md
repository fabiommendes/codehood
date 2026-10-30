---
type: issue
status: completed
tags: [resources, blobs, attachments]
relatedTo: [resource-service, attachment-service]
closed: 2026-10-30
---

# FILE resource writes leak attachments and leave half-written rows

- `ResourceService.update`/`upsert` always creates a new attachment for FILE
  data and never removes the old one (`resource.service.ts`, update path).
  - Same bytes and filename: `Unique constraint failed on (hash, filename,
    attachedToType, attachedToId)`. Re-running `manage import-resources` on
    an unchanged FILE fails.
  - New bytes: the old attachment stays on the resource, charged to the
    uploader's quota and never collected.
- `delete` is not transactional either, and removes blob directories from
  inside a DB transaction that a rollback cannot restore.
- A title-only `update` of a FILE resource returns `filename:
  "corrupted-file.txt"` and a `/files/corrupted/...` link. The stored row is
  fine; the returned shape is built without the attachment.
- `attachment.service.ts` `fromDbWithSources` throws a plain `Error` for a
  QUESTION attachment or one whose resource is gone, and its lookup ignores
  `attachedToType`. One such row breaks `findMany`.

Fixed:

- `AttachmentService.create` returns the existing attachment for the same
  bytes, filename and owner. `ResourceService.update` deletes the replaced
  attachment after writing the new one.
- `delete` runs in a transaction and removes the attachment last, so a
  failure before it leaves the files in place. Blob files still go before
  the commit; deferring every file operation past the commit is a change to
  `BlobService` as a whole.
- `update` returns the attachment the row points at.
- `fromDbWithSources` checks `attachedToType` and leaves out an attachment
  whose owner is gone; `findOne` returns `null` for it.

Replacing a file still counts the old and the new bytes against the quota
while the update runs.
