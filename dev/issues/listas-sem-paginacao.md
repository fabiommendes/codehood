---
type: issue
status: backlog
tags: [pagination, performance, rest]
kind: debt
priority: low
created: 2026-11-17
creator: claude
---

# Listas que ainda não paginam

A paginação de 2026-11 (ADR `dev/adr/0018-paginacao-das-listas-por-cursor.md`,
contrato em `src/api/README.md`, molde em
`report.service.ts`, `question.service.ts` e `user.service.ts`; páginas em
`src/pages/admin/users.astro` e `.../questions/index.astro`) cobriu as listas
do admin, `/courses`, relatos e o banco de questões. Nenhuma medição exige o
resto: tudo abaixo cresce com o tamanho de um curso, não com o do banco
(`pnpm run test:perf` não acusa nenhuma rota). Conferido no código em
2026-11-17.

## Páginas

- **`/roster` e `/attendance`.** `roster.astro` chama
  `db.enrollment.findMany`; `/attendance` usa `rollCall.courseAttendance`, que
  lê todas as matrículas e eventos. O CSV e os totais precisam do conjunto
  inteiro. Caminho provável: a tabela pagina com `findPage`, os totais vêm de
  `count` ou agregações e o CSV segue com `findMany`.
- **`/resources`.** `resource.findMany` do curso inteiro, agrupado por tipo e
  por evento; paginar grupos não é óbvio.
- **`/exams`.** `exam.findMany` do curso, e `ExamsTable` ordena no cliente
  (`table-sort.ts`). Seguir o molde de `/questions` (cursor composto, `sort`
  na URL).
- **`/calendar`.** `calendarEvent.findMany({ courseIds })` sem intervalo de
  datas, embora `calendarEventFilterBase` já aceite `from` e `to`. O mesmo
  filtro tem um `limit` ("as próximas três aulas"), que colide com o `limit`
  da paginação quando a rota REST de `calendar-event` paginar.

## Consultas mais estreitas

Não são tabelas: carregam tudo para usar uma parte.

- Correção, notas e revisões (`src/utils/load-grading.ts`, `grades.astro`,
  `exams/[slug].astro`, `regrades.astro`) montam tudo em memória a partir de
  todas as tentativas e feedbacks da prova ou do curso.
- `exams/[slug]/attempts/[username].astro` passa por `loadGrading` e carrega
  todas as tentativas para achar uma.
- `getting-started.astro` carrega as chaves de API só para testar se a lista
  é vazia.

## Achados sem dono

- `report.service.ts` (`toReport`) faz uma consulta de anexos por linha.
- `profile.astro` e `blob.service.ts` (GC) chamam `report.findMany` sem
  limite.
- A lista REST de questões não aceita `sort` (sempre por slug).
- Listar os feedbacks de um curso grande custa uns 100 ms fora do SQLite,
  pelos `include` de cada linha (medido em 2026-11-14).

Não valem mais: `CourseHeader.astro` não consulta o banco, e
`/openapi.json` guarda o documento em cache em produção.
