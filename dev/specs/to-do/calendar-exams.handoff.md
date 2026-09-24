---
type: spec
status: draft
tags: [codehood-server, calendar, time-slots, exams, sync, handoff, api]
relatedTo: [codehood-server, mapping-local-filesystem]
---

# Handoff to the server team: calendar, time slots and exams

The CLI is about to map `calendar.md` and `exams/` to server entities, per
[mapping-local-filesystem.md](../../../docs/design/mapping-local-filesystem.md).

You are an agent working in the Astro/TypeScript server repository. The CLI is
Python; do not assume shared code. Everything below was confirmed against
`http://localhost:4321/openapi.json` and `src/rpc/cli.ts` on 2026-09-23. Note
that `resources/openapi/codehood.json` in the CLI repo is stale relative to the
live server — the findings below describe the live server.

**Items 1, 2 and 5 landed on 2026-09-23, and item 4 landed but for one
rename.** They are kept here as a record. The open asks are item 3, which
blocks work, and the `scheduledAt` rename in item 4.

Two older gaps still stand and are not repeated here: `FILE` resource upload
(see `ROADBLOCKS.md`, item 1) and `Question` having no content-hash field (see
`ROADBLOCKS.md`).

## 1. Calendar events are unreachable by natural key — `done`

**Landed**: the collection is course-scoped, at
`GET /api/course/{discipline}/{course}/calendar-event`, and the global
`/api/calendar-event` is gone. No numeric course id anywhere. Original report
follows.

`GET /api/calendar-event` filters by `courseIds: number[]` only. `GET
/api/course/{discipline}/{course}` returns `description`, `discipline`,
`edition`, `instructor`, `enrollmentCount`, `startAt`, `endAt`, `createdAt`,
`updatedAt`, `joinedAt` — and no `id`.

So a client that knows a course only as `(discipline, instructor, edition)`,
which is all `codehood.toml` holds, has no way to list that course's events. It
cannot diff, cannot prune, and cannot see which events are `CANCELLED`.

`POST`/`PUT /api/calendar-event` already accept a natural key
(`course: {discipline, instructor, edition}`), so the write path is fine and
only the read path is stranded.

**What unblocks it**, cheapest first:

- Course-scope the collection the way time slots already are:
  `GET /api/course/{discipline}/{course}/calendar-event`. This matches
  `/exam`, `/question`, `/resource` and `/time-slot`, and is our preference.
- Or let `courseIds` accept the same natural-key object the write path takes.
- Or return `id` on the course read. This works but leaks a surrogate key into
  every client, which is what `ROADBLOCKS.md` already asks you to stop doing.

## 2. `CalendarEvent` has no documented upsert key — `done`

**Landed**: the key is `(week, timeSlot)` and it is addressable —
`GET`/`PATCH`/`DELETE .../calendar-event/{week}/{timeSlot}`. Pruning needs no
list-then-translate step. Original report follows.

`PUT /api/calendar-event` takes `{kind, title, description, week, ref, course,
timeSlot}`. Nothing in that body is obviously the identity: there is no `slug`,
and the response's `id` is a surrogate. `PATCH`/`DELETE` address an event by
numeric `id` only.

Two things we need:

- **Document the natural key** the `PUT` matches on. We assume
  `(course, timeSlot, week)`. If that is right, say so in the OpenAPI
  description; if it is not, tell us what is.
- **Make `DELETE` addressable by that key too**, or accept that pruning costs a
  list call per push to translate keys into ids. The list call is tolerable, but
  only once item 1 lands.

## 3. `cli.course.preSync` needs to actually report state — `high`

`src/rpc/cli.ts` defines `cli.course.preSync` as the method a `ch push` calls
before writing anything. Today it resolves the course, has its only query
commented out, and returns `{resources: []}` unconditionally. Its `summary` and
`description` are also copy-paste from a whoami method ("Echoes back who the
server thinks you are"), which will mislead anyone reading the generated
OpenRPC document.

This is the round-trip budget for the whole push. The CLI needs one call that
answers "what do you already hold, and how fresh is it" for every content type:

```
in:  {discipline, instructor, edition}
out: {
  resources:      [{slug, ref}],
  questions:      [{slug, version}],
  exams:          [{slug, ref}],
  timeSlots:      [{slug, ref}],
  calendarEvents: [{week, timeSlot, ref, kind}],
}
```

Two constraints on the shape, both deliberate:

- **Markers, never bodies.** Identifiers plus one hash per entity. No titles,
  no descriptions, no `data`, no question payloads. The CLI has all of that on
  disk already; it is comparing strings. The existing `courseSyncState` shape
  is right in spirit — `{slug, hash, timestamp}` — though we do not need
  `timestamp`, and the field is called `ref` everywhere else in the API, so
  `hash` should be `ref` too.
- **`kind` on calendar events is the one exception**, and it earns its place:
  see below.

`kind` matters because `CANCELLED` is an instructor action with no
representation in `calendar.md`, and a push regenerates every event from the
local file. We are taking responsibility for not resurrecting a cancelled
class: the CLI will skip any event `preSync` reports as `CANCELLED`, and will
not prune it either. That only works if `preSync` tells us. **No server-side
guard is needed** — do not add one; just include `kind`.

Note that this also closes FR-SYNC-002 (`ROADBLOCKS.md`, "no per-course
manifest endpoint"), which asks for exactly this and is currently worked around
by listing full rows over REST.

## 4. Exam duration and start have awkward shapes — `mostly done`

**Landed 2026-09-23**: `durationMs` is now `duration: {hours, minutes}`,
matching `TimeSlotCreate.duration`. `extraTimeMs` is gone from `ExamCreate`.

**Still open**: `scheduledAt` was not renamed to `start`. Exam files declare
`start:`, and `TimeSlotCreate` calls the same concept `start`, so the API now
uses two names for one idea. Either rename it or tell us `scheduledAt` is
deliberate — the CLI maps `start` -> `scheduledAt` in the meantime, which
costs nothing but reads badly in both directions.

## 5. Exam fields with no local source — `done`

All three are settled as of 2026-09-23:

- **`type: FINAL`** — removed from the enum. The CLI infers
  `PRACTICE | QUIZ | EXAM` from the path.
- **`extraTimeMs`** — gone from `ExamCreate`.
- **`format: PLAINTEXT | MARKDOWN | HTML`** — kept, and it does have a local
  source after all: it comes from the parsed MDQ document, defaulting to
  `MARKDOWN`. The CLI sends it.

## Status values we rely on

Recording these so a schema change does not break us silently. The CLI sets
exam `status` to `SCHEDULED` when the file declares a start time, `DRAFT`
otherwise, and `ARCHIVED` when the file is deleted. It never sets `ONGOING` or
`COMPLETED`, and never moves an exam out of `ONGOING` or `COMPLETED` — those
are yours.

## Suggested skills

Call the Skill tool for `domain-modeling` before shaping `preSync`'s output:
item 3 fixes the sync contract for every content type at once, not just
calendars, and is worth modelling as one decision. `code-review` afterwards.
