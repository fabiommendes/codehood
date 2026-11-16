# Story da chamada falha aos domingos

`test/stories/instructor-attendance.test.ts`, passo "a past meeting offers no
roll call", falha em todo domingo.

O teste cria o curso com início 28 dias atrás e supõe que a semana 4 cai hoje.
Num domingo (visto em 2026-11-15), a agenda põe a reunião de hoje na semana 3:
"ia-Arrays" (semana 3) aparece em 15/11 como "Next" e com o botão "Roll call", e
"ia-Pointers" (semana 4) em 22/11.

Provável causa: a semana do curso começa na segunda, e um início num domingo
desloca a contagem em uma semana. Falta decidir se o erro está no teste (a data
de início devia cair no começo de uma semana) ou na numeração das semanas.


## Mesma causa: `test/course-schedule-page.spec.ts`

O passo "the next meeting is marked and shows its lesson plan" falha aos
domingos (visto em 2026-11-15).

O curso começa 70 dias atrás, o que cai no mesmo dia da semana de hoje. Para um
início num domingo, a semana 0 começa na segunda seguinte (`courseWeekZero`),
então "Meeting ahead" (semana 12, no dia da semana de hoje) cai em
2026-12-06, 91 dias depois do início. Em qualquer outro dia ela cai 84 dias
depois do início, ou seja daqui a 14 dias. "Quiz ahead" está fixado em 20 dias
a partir de agora (2026-12-05), então só no domingo a prova vem antes da
reunião e leva o marcador "Next".

Confirmado pela página renderizada no domingo: "Quiz ahead" (5 dez) com "Next"
e "Meeting ahead" (6 dez) sem. A fixture do teste depende de o dia da semana
não ser domingo, como a da chamada.
