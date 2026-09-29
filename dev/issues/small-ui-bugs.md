---
type: note
status: active
tags: [ui, mdq, profile]
relatedTo: [short-answer, profile, course-home]
---

# Small UI and parsing bugs

- Short answer: any pattern starting with `/` and containing a second `/` is
  read as a regex without checking the flags. The literal answer `/dev/null`
  becomes regex `dev` with flags `null` (`src/mdq/short-answer.ts`).
- `/profile`: an admin cannot save without inventing a GitHub username and a
  school id; the form and the action require both.
- Course home: the Leave-course dialog's ✕ and backdrop are
  `type="button"` inside `<form method="dialog">`, so only Esc closes it.
- Course home: the Resources stat is hardcoded to `7`, and the Resources
  section is still mock data.
- `TrueFalseView.tsx` builds `text-base-content/${opacity}` at runtime, so
  Tailwind never generates the class; the `weight` ternary yields
  `font-bold` in both branches.
- `/manage` has no link to the gradebook, and `src/urls/README.md` still says
  the invite tools live on the Manage tab (they are on `/roster`).
