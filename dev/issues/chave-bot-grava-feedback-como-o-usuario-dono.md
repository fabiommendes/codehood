---
type: issue
status: backlog
tags: [api, rest, feedback, grading, api-key, bot]
kind: defect
priority: medium
created: 2026-11-13
creator: claude
---

# Chave `BOT` grava feedback como o usuário dono e marca `GRADED_MANUALLY`

Visto em produção (codehood.dev) em 2026-11-13, ao corrigir a prova `lista1-elm`
do curso `paradigmas/chips_2026-2` com `chalk codehood autograde` usando uma
chave do tipo `BOT`. A versão em produção é a `v0.3.2` ou anterior. Avaliar se
o comportamento ainda existe na `main` (o commit d75a304 menciona "grading
bots").

## O que acontece

O chalk grava com `PUT submission/<publicId>/feedback` e corpo
`{"ref": "chalk", "score": ..., "feedback": ...}`, sem `grader` nem `bot`. O
feedback criado sai com `grader: "chips"` (o dono da chave), `bot: null`, e a
submissão passa a `GRADED_MANUALLY`. Foi assim nas 384 notas da prova.

Pelo código da `v0.3.2`, `feedback.service.ts:resolveGrader` usa o ator como
grader quando o corpo não traz `bot`. `ApiKey` tem `kind` e `createdBy`, mas o
`kind: BOT` não muda o ator nem identifica um bot.

## Impacto

- Correção automática aparece como correção manual do professor.
- O status `GRADED_MANUALLY` tira a submissão das buscas por
  `PENDING_GRADE`/`GRADED_AUTOMATICALLY`, então um corretor externo não a revê.
- A distinção entre feedback humano e de máquina, que o chalk usa para não
  sobrescrever correção humana, depende de o servidor registrar o bot.

## Comportamento desejado

Uma escrita feita com chave `BOT` é registrada como de um bot
(`GRADED_AUTOMATICALLY`, `bot` preenchido), sem o cliente precisar saber um id
de bot. Alternativa: documentar qual `bot` o cliente deve enviar e expor esse
id para a chave.

## Critérios de aceite

- `PUT` de feedback com chave `BOT`, sem `grader`/`bot` no corpo, gera
  `GRADED_AUTOMATICALLY` e `bot` não nulo.
- Chave de usuário (CLI) continua gravando como o usuário.
