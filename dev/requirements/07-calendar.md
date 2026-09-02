# Calendar

## Time slots

**FR-CAL-001** — A course MUST declare its recurring meetings as `TimeSlot`
rows: a weekday, a start time, and an end time.

**FR-CAL-002** — Every `Event` MUST belong to a `TimeSlot`. Events detached from
the weekly schedule are not representable.

> A multi-day recess is therefore several events, one per displaced meeting.
> Deadlines outside class hours are not calendar entries in V1.

## Events

**FR-CAL-010** — Events MUST be authored in the repository and pushed by the
CLI. The server MUST NOT generate them by expanding time slots.

**FR-CAL-011** — An event MUST carry a kind, replacing the current `isHoliday`
boolean:

`LECTURE` · `LAB` · `EXAM` · `REVIEW` · `SEMINAR` · `PROJECT` · `SELF_STUDY` ·
`HOLIDAY` · `RECESS` · `CANCELLED`

**FR-CAL-012** — A cancelled or suspended meeting MUST retain its title and
description, so the calendar can show what would have happened.

**FR-CAL-013** — An event MAY link to an exam through a nullable `examId`. The
link MUST NOT be restricted to `EXAM`-kind events.

**FR-CAL-014** — Deleting an event from the repository MUST delete the row
(FR-SYNC-013). Events are not archived.

**FR-CAL-015** — `Event.week` MUST be authored, not derived. Week numbering is
the instructor's, and a holiday does not renumber the weeks around it.

## Views

**FR-CAL-020** — A course MUST present its own calendar, visible to enrolled
students and the instructor.

**FR-CAL-021** — `/calendar` MUST aggregate the viewer's courses into one
schedule.

**FR-CAL-022** — All times MUST be rendered in the server's configured time
zone (FR-NFR-020).

## Schema impact

Nothing writes these tables yet, so this is a create rather than a migration.

- `Event` → `CalendarEvent`. `Event` is a DOM global, and a page importing the
  row type shadows it.
- `Event.start`/`end DateTime` → `startAt DateTime` + `durationMin Int`. Stored
  UTC per FR-NFR-020, rendered in the server zone per FR-CAL-022, and the same
  shape `Exam` already uses (`scheduledAt` + `durationMs`).
- `TimeSlot.endMin` → `durationMin`, so the weekly pattern and the dated meeting
  are spelled the same way.
- `TimeSlot` gains `slug` (its sync identity, stable when the hour moves) and an
  optional `title` for the syllabus line.
- `Event.isHoliday Boolean` → `kind EventKind`.
- `Event` gains `examId Int?` with a relation to `Exam`, derived from window
  overlap rather than authored.
- `Event` gains `courseId`, with a composite foreign key pinning it to its
  slot's course, and `contentHash`, the CLI-supplied manifest marker
  (FR-SYNC-002).
- `WEEKDAY` → `Weekday`, matching `Role` and `ApiKeyKind`.

## Open questions

Both of the questions this file opened are answered in
`dev/specs/to-do/calendar.md` and are recorded here for the trail:

- **No `OFFICE_HOURS`, `WORKSHOP`, or guest-talk kind in V1.** Office hours are
  recurring and undated — a `TimeSlot` with a title and no events, which the
  syllabus line already renders.
- **The two times are independent and may disagree.** The link is derived from
  window overlap, the calendar shows the event's hours, the exam page shows its
  own, and the instructor sees a warning when an exam runs past the meetings it
  overlaps.
