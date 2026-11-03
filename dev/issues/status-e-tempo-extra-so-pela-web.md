---
type: issue
status: backlog
tags: [exam, api, rest, cli, sync]
kind: task
priority: medium
created: 2026-11-03
creator: claude
---

# `status` e tempo extra do exame só pela web

## Problema

O REST aceita `status` (qualquer um dos cinco) e `extraTime` na escrita de
exames:

- `status: examStatus.optional()` em `examCreate`, herdado por `examUpdate`
  (`src/core/schemas/exam.ts:89`, `:103-106`);
- `extraTime` em `examUpdate` (`src/core/schemas/exam.ts:105`), testado em
  `test/api-exam.spec.ts:166` ("PATCH sets and clears duration and
  extraTime");
- `ExamService.updateTx` grava os dois sem olhar o status atual
  (`src/db/services/exam.service.ts:332`, `:341`).

Um campo que o push pode escrever é um campo que o próximo push desfaz em
silêncio. Tempo extra dado pela web some no push seguinte; um exame aberto ou
reaberto pela web volta para `SCHEDULED`. A regra está em
`dev/adr/0011-contrato-de-sync-entre-cli-e-servidor.md`.

Hoje não há ação web para começar um exame antes da data nem para reabrir um
exame: só o REST com `status: ONGOING` faz isso.

## Como o CLI usa `status`

O CLI ainda não envia exames (`cli/ROADMAP.md:17`). O plano em
`cli/dev/specs/to-do/push-exams.md:94-108` deriva o status do repositório:
`DRAFT` se o arquivo ou algum diretório começa com `_`, `SCHEDULED` se o exame
declara início, `DRAFT` senão; apagar o arquivo vira `ARCHIVED`. O CLI omite
`status` quando o servidor reporta `ONGOING` ou `COMPLETED`, e já deixa
`extraTime` de fora (`:39`).

Então `DRAFT → SCHEDULED` vem do repositório e deve continuar no REST.

## Proposta

- `status` no REST aceita só `DRAFT | SCHEDULED | ARCHIVED`. `ONGOING` e
  `COMPLETED` são recusados com 400.
- O service ignora (e reporta) um `status` enviado pelo REST quando o status
  gravado é `ONGOING` ou `COMPLETED`, para não depender só da guarda do CLI.
  Alinhar a forma do aviso com o que o ADR 0011 decidir para campos
  ignorados.
- Tirar `extraTime` de `examUpdate`. Atualizar `test/api-exam.spec.ts:166`.
  `test/bruno/exam/Update.yml:13` manda `SCHEDULED` e continua válido.
- Métodos dedicados no `ExamService`, no molde de `releaseGrades`
  (`src/db/services/exam.service.ts:392`), e actions finas em
  `src/actions/exam.ts`:
  - `start`: "começar agora", `SCHEDULED → ONGOING`;
  - `reopen`: reabrir um exame fechado (`COMPLETED → ONGOING`);
  - `setExtraTime`: tempo extra global do exame.
- Botões na página do exame para o instrutor
  (`src/pages/[discipline]/[course]/exams/[slug].astro`).

Ponto de atenção: "começar agora" não deve reescrever `scheduledAt`, senão o
próximo push com a data do arquivo desfaz a mudança. A janela de um exame
`ONGOING` aberto antes da data precisa ser definida (hoje `examPhase` fecha em
`scheduledAt + duration + extraTime`, `src/services/exam-state.ts:63-64`).

## Critérios de aceitação

- [ ] POST/PATCH com `status: ONGOING` ou `COMPLETED` retorna 400.
- [ ] PATCH com `extraTime` não altera o tempo extra.
- [ ] PATCH com `status: SCHEDULED` num exame `ONGOING` não o rebaixa.
- [ ] As três ações web funcionam só para o dono do curso, com teste de
      permissão.
- [ ] Tempo extra dado pela web sobrevive a um PATCH/upsert seguinte.
- [ ] `src/db/bootstrap.ts` tem exame em cada estado alcançável pelas ações.
