---
type: issue
status: backlog
tags: [exam, sync, cli, calendar]
kind: feature
priority: low
created: 2026-11-03
creator: claude
---

# Congelar a agenda do exame em andamento

Ideia que só existia como requisito, sem story nem spec. **Precisa de
validação antes de virar story.**

## Problema

Um push pode mudar `scheduledAt` e `duration` de um exame já aberto ou
fechado: `ExamService.updateTx` grava os dois sem checar status
(`src/db/services/exam.service.ts:337-338`). Mudar a data no meio da prova
muda a janela de todos os alunos.

## Proposta

- A partir de `ONGOING` (e para exames fechados), `scheduledAt` e `duration`
  ficam congelados para o push.
- Escrita que toca campo congelado não falha: aplica o resto e reporta os
  campos ignorados na resposta. Depois de um "começar agora" pela web o
  repositório discorda do banco para sempre; recusar travaria o push do curso.
- Como a fase é derivada do relógio (`examPhase`,
  `src/services/exam-state.ts:58`), "em andamento" precisa ser definido: fase
  `open` ou `closed`, ou primeira tentativa aberta.

Relacionado: `dev/issues/escrita-em-exame-em-andamento.md`,
`dev/issues/status-e-tempo-extra-so-pela-web.md`.

## Critérios de aceitação

- [ ] Story validada pelo humano.
- [ ] Push com outra data num exame aberto mantém a data e reporta o campo.
