---
type: issue
status: todo
tags: [release, calendar, data]
relatedTo: [calendar-event, time-slot]
kind: task
priority: high
created: 2026-11-03
creator: Fábio Macêdo Mendes
---

# Recalcular os horários dos eventos na próxima release

A semana 0 de uma turma passou a ser a semana ISO (segunda a domingo) em que
`course.startAt` cai. Antes ela começava no primeiro dia do horário igual ou
posterior a `startAt`. Os eventos já gravados guardam o `startAt` calculado
pela regra antiga, e numa turma que não começa na segunda os horários das
segundas (e de outros dias antes do dia de início) ficam uma semana adiantados.

Não há mudança de schema, então `pnpm run release` não gera migration para
isso. Depois de aplicar a release em produção, rode uma vez:

```bash
pnpm run manage recompute-event-times
```

O comando recalcula `startAt` e `durationMin` de todos os eventos a partir do
curso, do horário e da semana, e informa quantos mudaram. Rodar de novo não
muda nada.

Feche esta issue depois de rodar o comando em produção.
