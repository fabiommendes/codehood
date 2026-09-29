---
type: note
status: active
tags: [resources, blobs, attachments]
relatedTo: [resource-service, attachment-service]
---

# FILE resource writes leak attachments and leave half-written rows

- `ResourceService.update`/`upsert` always creates a new attachment for FILE
  data and never removes the old one (`resource.service.ts`, update path).
  - Same bytes and filename: `Unique constraint failed on (hash, filename,
    attachedToType, attachedToId)`. Re-running `manage import-resources` on
    an unchanged FILE fails.
  - New bytes: the old attachment stays on the resource, charged to the
    uploader's quota and never collected.
- `create` is not transactional. A FILE create that fails on the filename or
  the quota leaves a `Resource` row with `attachmentId = null`; a retry then
  collides on `(courseId, slug)`.
- `delete` is not transactional either, and removes blob directories from
  inside a DB transaction that a rollback cannot restore.
- A title-only `update` of a FILE resource returns `filename:
  "corrupted-file.txt"` and a `/files/corrupted/...` link. The stored row is
  fine; the returned shape is built without the attachment.
- `resourceCreate` takes `slug: z.string().min(1)` instead of the `slug`
  format. `"Week 1/Notes"` is accepted and can then never be fetched by key.
- `attachment.service.ts` `fromDbWithSources` throws a plain `Error` for a
  QUESTION attachment or one whose resource is gone, and its lookup ignores
  `attachedToType`. One such row breaks `findMany`.
