---
type: spec
status: to-do
tags: [grading, course-grade, grade-column, cli, instructor]
relatedTo: [web-grading, grades-table, exam-result, codehood-toml, push-grades]
---

# The course's final grade

## Context

The Grades tab shows every student against every exam and has no total. The
instructor downloads the table as CSV and computes the final grade in a
spreadsheet, and students never see the result on Codehood.

Codehood does not compute the course grade. The instructor computes it on
their own machine, with a Python function the CLI calls, and the CLI pushes
the result as grade columns. The server stores the columns, shows them beside
the exams, and shows each student their own value once the instructor
releases a column.

This spec covers the server. The CLI's half, with the contract of the
instructor's function, is `cli/dev/specs/to-do/push-grades.md`.

## Reference case

One real course, which the design must be able to express. Other courses
will differ.

1. Exams, each with a weight.
2. A substitute exam, which replaces the score of one of the exams.
3. Assignments, graded outside Codehood, with a weight of their own.
4. The weighted result converts to a UnB letter grade: SS, MS, MM, MI, II,
   SR.
5. A student reaches a minimum letter grade by meeting criteria that are not
   part of the weighted result, such as a score on the final assignment at or
   above some value.

Items 3 and 5 read scores no exam in Codehood produces, item 2 picks between
two scores, item 4 maps a number to a label and item 5 overrides the label
under a condition. A flat weight per exam covers none of them.

## Decisions

- **The rule lives in the course folder** and reaches the server with
  `codehood push`. The web shows the result and never edits it (P8).
- **No formula language.** A formula syntax in `codehood.toml`, evaluated by
  the server, would keep the grade always current, at the cost of a grammar,
  an evaluator, error messages and a version to keep compatible. A Python
  function on the instructor's machine expresses every scheme with none of
  that. The price is that a column is only as current as the last push.
- **The substitute exam has no rule of its own.** It is one more score the
  function reads.
- **A column is a number or a label**, declared with the column. The server
  shows a number as pushed and has no scale of its own. The final letter
  grade is a label column.
- **No "final grade" marker.** The table shows every pushed column. Which
  one is the course grade is what its title says.
- **A column is hidden from students until the instructor releases it** on
  the web, like an exam's results.
- **`GradeColumn` is the aggregate.** The service, the REST API and `rev`
  address columns. A column's values travel inside it and have no service or
  endpoint of their own.

## Glossary

- **Grade column**: a column of the Grades tab that the instructor pushed,
  with at most one value per student.
- **Released column**: a grade column whose values its students can see.

## Schema

```prisma
enum GradeColumnKind {
  NUMBER
  LABEL
}

model GradeColumn {
  id   Int             @id @default(autoincrement())
  kind GradeColumnKind

  courseId Int
  course   Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

  slug     String
  title    String
  /// Order among the course's grade columns, supplied by the writer.
  position Int

  /// When students started seeing the column. Null while it is hidden.
  releasedAt DateTime?

  /// Revision marker supplied by the writer, opaque to the server.
  rev String?

  values GradeValue[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([courseId, slug])
}

model GradeValue {
  id Int @id @default(autoincrement())

  columnId Int
  column   GradeColumn @relation(fields: [columnId], references: [id], onDelete: Cascade)

  username String
  user     User   @relation(fields: [username], references: [username], onDelete: Cascade)

  /// Set on a NUMBER column.
  number Float?
  /// Set on a LABEL column.
  label  String?

  @@unique([columnId, username])
  @@index([username])
}
```

A student with no value in a column has no `GradeValue` row.

## Requirements

`<course>` stands for `/<discipline>/<instructor>_<edition>`, and `<api>` for
`/api/course/<discipline>/<instructor>_<edition>`.

### R1: A grade column over the service and the API

`db.gradeColumn` is a regular service, exposed with `CRUD()` at
`<api>/grade-column`, item key `/[slug]`. Over the API a column reads:

```json
{
  "slug": "final",
  "title": "Final grade",
  "kind": "LABEL",
  "position": 2,
  "releasedAt": null,
  "rev": "9f2c...",
  "values": [
    { "username": "hopper", "value": "MS" },
    { "username": "turing", "value": "SS" }
  ],
  "createdAt": "...",
  "updatedAt": "..."
}
```

- `slug` follows the base `slug` schema. `title` is 1 to 80 characters.
- `value` is a finite number on a `NUMBER` column and a string of 1 to 32
  characters on a `LABEL` column.
- `values` is ordered by username.

Acceptance criteria:
- Given instructor `ada` of `cs101`, when she `PUT`s the column above, then
  `GET <api>/grade-column/final` returns it with `releasedAt: null`.
- Given a `NUMBER` column, when a write carries a string value, then it is
  refused with a validation error on that value, and nothing is written.
- Given a write whose `values` list the same username twice, then it is
  refused with a validation error.

### R2: A write replaces the column whole

`create`, `upsert` and `update` take `values` as the column's complete set:
students absent from the list lose their value. `update` without `values`
leaves them alone, and is refused when it changes `kind`, since the stored
values would no longer fit. All of it runs in one transaction. `releasedAt` is not
writable through any of them, so a pushed change to a released column
reaches students at once and a new column starts hidden.

Every username in `values` must be enrolled in the course, active or
dropped. One that is not refuses the whole write, with a validation error
listing each of them.

`delete` removes the column and its values.

Acceptance criteria:
- Given column `final` with values for `hopper` and `turing`, when it is
  upserted with a value for `hopper` only, then `turing` has no value.
- Given the same column, when it is upserted with a value for `nobody`, who
  is not enrolled in `cs101`, then the write is refused and both values are
  unchanged.
- Given a released column, when it is upserted with new values, then
  `releasedAt` is unchanged.
- Given a `PUT` or `PATCH` whose body carries `releasedAt`, then the column's
  `releasedAt` is unchanged.
- Given a `NUMBER` column with values, when it is updated to `kind: LABEL`
  with no `values`, then the update is refused and the column is unchanged.

### R3: Who reads and writes a column

- The course's instructor, and a CLI or bot key acting as them, reads every
  column with every value, and writes.
- A student with an active enrollment reads released columns only, each with
  `values` holding their own value or nothing. A hidden column does not
  exist for them: `findOne` answers as for a slug that is not there.
- Anyone else is refused.

Acceptance criteria:
- Given a hidden column `final` and a released column `assignments` in
  `cs101`, when student `hopper` lists the course's columns, then she gets
  `assignments` only, and its `values` hold her entry and no other.
- Given the same, when `hopper` reads `final`, then the answer is 404.
- Given `hopper` with no value in the released column, then its `values` is
  empty.
- Given `hopper`, when she writes or deletes a column, then she is refused.
- Given a student who is not enrolled in `cs101`, when they list its
  columns, then they are refused.

### R4: Release

`db.gradeColumn.release(key, opts)` sets `releasedAt` to now. Only the
course's instructor may call it. Releasing a released column returns it
unchanged. There is no way back: to withdraw a column, the instructor
removes it from the course folder and pushes.

The web calls it from an Astro Action. The REST API does not expose it.

Acceptance criteria:
- Given a hidden column, when `ada` releases it, then `releasedAt` is set and
  `hopper` reads the column.
- Given a column released at `t`, when `ada` releases it again, then
  `releasedAt` is still `t`.
- Given `hopper`, when she calls the action, then she is refused.

### R5: The grades of a course over the API

`GET <api>/grades` returns what the Grades tab shows, for the CLI to feed
the instructor's function. Only the course's instructor may read it.

```json
{
  "exams": [{ "slug": "midterm", "title": "Midterm", "scheduledAt": "..." }],
  "students": [
    {
      "username": "hopper",
      "name": "Grace Hopper",
      "email": "hopper@example.com",
      "schoolId": "190012345",
      "githubId": "ghopper",
      "status": "ACTIVE",
      "results": { "midterm": { "kind": "total", "total": 0.83 } }
    }
  ]
}
```

- `exams` are the columns of `gradesTable`, in its order.
- `students` are every enrolled student, dropped ones included, in the
  table's order.
- `results` has one entry per exam, a `GradeCell` of `gradesTable`: `total`
  (with `total` in `[-1, 1]`), `pending`, `in-progress`, `missed` or `empty`.

Acceptance criteria:
- Given `cs101` with exams `midterm` and `final-exam` and a dropped student,
  when `ada` reads the endpoint, then both exams and the dropped student are
  listed, and every student has a result for each exam.
- Given `hopper`, when she reads it, then she is refused.

### R6: Pushed columns on the Grades tab

The table shows the course's grade columns after the exams, ordered by
`position`, ties by slug.

- The header shows the title and, on a hidden column, a "Hidden" badge and a
  "Release" button. A released column shows neither.
- A number reads as pushed, rounded to at most two decimals. A label reads
  as pushed. A student with no value reads as an empty cell.
- "Release" asks for confirmation with the column's title and how many
  students have a value, then calls the action of R4.
- Pushed columns have no mean and no attempt count.
- A course with no grade column shows the table as it is today. "No exams
  yet" shows only when the course has neither an exam nor a grade column.

Acceptance criteria:
- Given columns `assignments` (position 0) and `final` (position 1), then
  the table's headers read the exams, then "Assignments", then "Final grade".
- Given `hopper` with `87.456` in `assignments`, then her cell reads `87.46`.
- Given hidden column `final`, when `ada` confirms "Release", then the badge
  and the button are gone after the page reloads.
- At 390 px the table scrolls sideways and the student column stays in
  place.

### R7: Pushed columns in the CSV download

The grades CSV carries one column per grade column after the exams, headed
by its slug, released or not. A number is written as pushed, a label as
text, and no value as an empty cell.

A grade column whose slug equals an exam's yields two CSV columns with the
same header. The server does not prevent it.

Acceptance criteria:
- Given exams `midterm` and columns `assignments` and `final`, then the
  header reads `username,name,status,midterm,assignments,final`.

### R8: A student sees their grades on the course home

The course home of an enrolled student shows a "Grades" block listing the
released columns in table order, each with its title and the student's
value. A column where the student has no value reads "No grade". With no
released column the block is absent. The instructor does not get the block.

Acceptance criteria:
- Given released `assignments` with `87.5` for `hopper` and hidden `final`,
  then `hopper`'s course home lists "Assignments 87.5" and does not mention
  "Final grade".
- Given `final` released later with no value for `hopper`, then the block
  also lists "Final grade" with "No grade".
- Given a course with no released column, then `hopper`'s course home has no
  "Grades" block.

### R9: Seed

`src/db/bootstrap.ts` seeds, in a course that has exams and a dropped
student: a released `NUMBER` column, a hidden `LABEL` column, and one active
student with no value in either.

## UI contract

What tests and pages agree on. Roles and accessible names, not markup.

Grades tab (`<course>/grades`), inside the table labelled "Grades":

- Each grade column is a column header whose text starts with the column's
  title, after the exam headers.
- A hidden column's header holds the text "Hidden" and a button named
  "Release <title>". A released column's header holds neither.
- The button opens a dialog headed "Release <title>?" that states how many
  students have a value, as "<n> students will see their grade." (or
  "1 student will see their grade."), and that it cannot be undone. Its
  buttons are "Cancel" and "Release".
- After "Release" succeeds the page reloads. A failure shows in an element
  with role `alert`.
- A student's cell in a grade column holds the formatted value, or is empty.

Student's course home (`<course>`):

- A region headed by a level 2 heading "Grades", holding a list labelled
  "Grades" with one item per released column, in table order.
- An item reads the column's title followed by the student's value, or by
  "No grade".

## Out of scope

- Computing a grade on the server, in any form.
- Hiding a released column again.
- A mean, a histogram or any other summary of a pushed column.
- Editing a value on the web.
- Notifying students of a release.
