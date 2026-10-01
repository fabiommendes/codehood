---
type: spec
status: to-do
tags: [resources, calendar, schedule, cli, api]
relatedTo: [resource-service, calendar-event-service, course-schedule]
---

# Resources attached to calendar events

A course with slides, notes and exercises for every meeting buries its general
material under dozens of per-meeting files on the Resources tab. A resource may
instead belong to one [Event](../../../GLOSSARY.md#event): it then shows under
that meeting on the schedule and stays off the Resources tab.

## Data

- **R1.** `Resource` gets an optional foreign key to `CalendarEvent`:
  `eventId Int?`, `onDelete: SetNull`, indexed. The event must belong to the
  resource's course.
- **R2.** Deleting an event (a calendar push drops a meeting) keeps its
  resources; they fall back to general resources until the next push attaches
  them elsewhere or deletes them.

## Service and REST

- **R3.** `resourceCreate` and `resourceUpdate` take
  `event: { week: number, timeSlot: string } | null`, the natural key the CLI
  already uses for events (`timeSlot` is the slot's slug). The service
  resolves it inside the resource's course and rejects a key with no event
  (`NotFound`, 404 over REST). Omitted means `null`.
- **R4.** `resourceSchema` returns `event: { id, week, timeSlot } | null`, so a
  pull round-trips the key.
- **R5.** `resource.findMany` accepts `event?: CalendarEventId | null`:
  an id lists that event's resources, `null` lists general resources only,
  omitted lists all. The order stays by title.
- **R6.** The OpenAPI spec and `cli/codehood/api/generated.py` are
  regenerated.

## CLI

- **R7.** A
  markdown link inside a lesson of `calendar.md` to a file under
  `resources/` attaches that resource to the lesson's event, e.g.
  `[Slides](resources/w03/recursion.pdf)`. The CLI sends the event key with
  the resource and rewrites the link in the pushed description to the
  resource's URL. A resource linked from two lessons is an error.
- **R8.** The push sends the calendar before the resources, so the events
  exist when a resource names one.

## Web

- **R9.** Schedule (`ScheduleWeek.astro`): an event's resources are listed
  under its description as compact rows, an icon and the title, behaving as
  on the Resources tab: a file downloads, a link opens in another tab, a note
  or snippet opens its page.
- **R10.** Resources tab and the course home preview list general resources
  only. When the course has event resources, the tab says so in one line,
  linking to the schedule.
- **R11.** A note or snippet page of an event resource links back to its
  event's row on the schedule (`#event-<id>`).
- **R12.** `src/db/bootstrap.ts` attaches a few cs101 resources to meetings,
  one past and one ahead, of each type.

## Acceptance

- A resource pushed with an event key shows under that meeting on the
  schedule and not on the Resources tab or the course home.
- A key with no matching event is rejected with 404 and nothing is written.
- Deleting the event leaves the resource on the Resources tab.
- A student of another course cannot read an event resource by id or slug.

## Order of work

Implement after the grade-column migration lands, so the two schema changes do
not conflict.
