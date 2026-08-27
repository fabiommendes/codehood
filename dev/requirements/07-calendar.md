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

- `Event.isHoliday Boolean` → `kind EventKind`.
- `Event` gains `examId Int?` with a relation to `Exam`.

## Open questions

- Does the kind list need `OFFICE_HOURS`, `WORKSHOP`, or a guest-talk value?
- Should an `EXAM` event with a linked exam inherit its times, or are the two
  independent and allowed to disagree?
