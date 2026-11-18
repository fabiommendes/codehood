---
type: issue
status: todo
tags: [cli, reports, triage]
relatedTo: [reports]
kind: feature
priority: medium
created: 2026-10-26
---

# Pull and triage user reports

The server collects reports from its users (bugs, suggestions, errors in a
course's material) at `/api/report`; see `src/db/services/report.service.ts`
and the `/api/report` declarations in `src/api/index.ts`. Triage happens locally, and the status on the server is the
checkpoint: a report leaves the `OPEN` queue once someone patches its status.

Add commands along the lines of:

- `ch reports pull`: `GET /api/report?status=OPEN`, writes one file per report
  (message, context, author, course) and downloads its attachments from
  `/api/report/<publicId>/attachment/<filename>`.
- `ch reports triage <publicId> <status> [--note ...] [--kind ...]`:
  `PATCH /api/report/<publicId>`.

An instructor sees and triages only the `CONTENT` reports of their own
courses; an admin sees all of them. The commands need no rule of their own:
the server filters by the API key's user.
