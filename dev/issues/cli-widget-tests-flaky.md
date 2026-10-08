---
type: issue
status: active
tags: [cli, testing, textual, flaky]
relatedTo: [cli, widgets]
---

# CLI question widget tests are flaky

`cli/tests/test_widgets_questions.py` fails intermittently, even when run
alone: `test_multiple_choice_records_the_picked_id` and
`test_multiple_selection_records_every_ticked_id` failed in two of three
consecutive runs and passed in the third. The failures look like Textual
timing (a pilot action read before the widget processed it).

Fix: await the widget's update (`pilot.pause()` or a wait on the recorded
answer) before asserting.
