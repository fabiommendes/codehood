---
type: note
status: active
tags: [calendar, time-slot, import]
relatedTo: [calendar-event-service, import-calendar]
---

# Calendar: week anchor, slot edits and the import command

- Week 0 is the first slot weekday on or after `course.startAt`, not the ISO
  week (Monday) the schema documents. A course starting on a Wednesday puts
  its Monday slot's week 0 five days later, in the next ISO week, so "Week 1"
  groups Wed 11 with Mon 16.
- `TimeSlotService.update` touches no events. After a slot changes, the stored
  `startAt` keeps the old hour, `durationMin` goes stale (and `findMany`'s
  `from` filter uses it), while `/schedule` computes the end from the new
  slot duration.
- `findMany` has no database lower bound for `from`: it loads every event
  before `to` and filters in memory.
- `/schedule` "N meeting(s) held so far" counts every REGULAR event, future
  ones included.
- `/calendar?month=2026-13` passes the regex, renders January 2027, and the
  "next" link becomes `2026-14`.
- `manage import-calendar`:
  - event `date`/`start`/`duration` are parsed and silently ignored;
  - `RECESS` collapses to `REGULAR`, so a recess counts as a meeting;
  - `--prune` still runs after a slot import fails, deleting every event on
    that slot;
  - the documented format uses 1-based weeks, the service 0-based;
  - no tests.
- `weekdayOnOrAfter` in `src/utils/schedule-time.ts` has no caller left in
  `src/` since `slotInstant` replaced it.
