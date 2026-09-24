# Student exam list

## Scope

Two pages change:

1. `/<discipline>/<course>/exams` — a student sees a sectioned list of exam
   cards instead of the instructor's sortable table.
2. `/<discipline>/<course>/` — the home page's "Upcoming exams" section reads
   real exams instead of the hardcoded placeholder rows.

Out of scope: exam detail, taking an exam, grades. The "Past exams and grades"
section lists past exams only; there is no grade data to show yet (no
submission/grade service), and adding one belongs to the "See my grades and
feedback" story.

## Who sees what

The table stays for whoever may write the course's contents
(`hasPerm(actor, "course.update-contents", course)`), because it is the only
view that shows `DRAFT`/`ARCHIVED` rows, status and tags. Everyone else gets
the sectioned card list. Same page, same service call, one branch in the
template.

## Sections

`groupExamsForStudent(exams)` is a pure function next to
`groupResourcesByType` in `src/db/services/exam.service.ts`, re-exported from
`src/db/index.ts`. It takes the exams the service already narrowed for the
actor and returns the non-empty sections, in this fixed order:

| Section | Key | Holds | Order within |
| :--- | :--- | :--- | :--- |
| Open | `open` | `ONGOING`, not `PRACTICE` | `scheduledAt` ascending, unscheduled last |
| Practice | `practice` | `PRACTICE`, status not `COMPLETED` | title ascending |
| Upcoming | `upcoming` | `SCHEDULED`, not `PRACTICE` | `scheduledAt` ascending, unscheduled last |
| Past exams and grades | `past` | `COMPLETED`, any type | `scheduledAt` descending, unscheduled last |

`DRAFT` and `ARCHIVED` are dropped by the function as well, not just by the
service, so the instructor's own list cannot leak a draft into a student-shaped
section if the function is ever reused.

Every exam the student can see lands in exactly one section.

## Rows

`ExamRow.astro` (in `src/components/exam/`) wraps the existing `ListRow` with
the exam's title, a detail line and a trailing status badge:

- Title links to `${href}/exams/${slug}`.
- Detail line: type label, duration, and the schedule (`formatDateTime`) when
  the exam carries one. `Not scheduled` when it does not.
- Trailing badge: the exam's status, via `examStatusBadgeClass`.

Both pages render rows through this component, which is the "list of element
cards" pattern `ListRow` already carries for resources.

## Home page

- The `Exams` stat shows the number of exams the viewer can see.
- The "Upcoming exams" section renders the `upcoming` section. With no upcoming
  exam it renders `practice` under the heading "Practice" instead. With neither,
  the whole section is omitted.
- Layout, `SectionHeader` and the "View all" link stay as they are.

## Tests

- `test/exam-grouping.spec.ts` — the pure function: placement per
  status/type pair, ordering within a section, empty sections absent,
  drafts and archived dropped.
- `test/stories/student-exams-and-practice.test.ts` —
  `student: see the exams assigned to me`, driving the UI: a student sees the
  four sections with the right exams in each, no draft, and no table; the home
  page shows the upcoming exam, and falls back to practice when there is none.
- `src/fixtures/exam.factory.ts` — `examFactory`/`persistedExamFactory`,
  mirroring `question.factory.ts`.
- `docs/user-stories/student.md`: "See the exams assigned to me" becomes
  `status: implemented`; `pnpm run stories` regenerates `coverage.md`.

No schema change.
