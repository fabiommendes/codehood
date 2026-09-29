---
type: note
status: active
tags: [api, errors, rpc]
relatedTo: [time-slot, calendar-event, invite, api-key]
---

# REST and RPC status codes for business-rule failures

- Business rules throw a plain `Error`, which `core/error.ts` maps to 500
  `internal-error` (RPC `-32603`; `-32000` never fires):
  - time slot overlap, zero duration, running past midnight, deleting a slot
    that has events, a slot from another course (`time-slot.service.ts`,
    `calendar-event.service.ts`);
  - `CourseService.update` and `EditionService.update` on an unknown key
    (should be `NotFound`).
- `DELETE` under a course that does not exist returns 200 `{deleted:false}`:
  `deleteHandler` swallows the course `NotFound`.
- `DELETE /api/api-key/<unknown>` is 403, not 404.
- `POST /api/invite` still accepts a raw numeric `course` id (`inviteCreate`
  and `inviteFilter` keep the `courseId` branch of the union).
- `resource.service.ts` checks the update permission under the action code
  `"resource.read"`.
