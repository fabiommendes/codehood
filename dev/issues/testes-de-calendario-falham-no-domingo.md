---
type: issue
status: open
tags: [tests, schedule, attendance]
created: 2026-11-08
creator: claude
---

# Testes de calendário falham num domingo

Em 2026-11-08 (domingo), dois testes falharam de forma estável, em três
rodadas seguidas, sem que nada no código de calendário tivesse mudado:

- `test/course-schedule-page.spec.ts`: "the schedule folds the weeks already
  held and shows the exams among the meetings".
- `test/stories/instructor-attendance.test.ts`: o passo "a past meeting offers
  no roll call" vê o botão Roll call no encontro `ia-Arrays`, que deveria ser
  da semana anterior.

Os dois montam o curso com `Date.now() - 28 * DAY` e contam semanas a partir
dele. Hipótese não verificada: no domingo, a semana do curso e a semana do
calendário começam em dias diferentes, e o encontro "passado" cai na semana
corrente. Conferir rodando com a data fixada num domingo e num dia útil.
