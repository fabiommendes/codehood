---
type: issue
status: deferred
tags: [tests, flaky]
kind: defect
priority: low
created: 2026-10-28
creator: Fábio Macêdo Mendes
---

# `islands-no-raw-ids` falha às vezes na página da prova

O caso "exam detail (ExamQuestionsList)" de `test/islands-no-raw-ids.spec.ts:81`
falhou duas vezes na suíte completa com a página não carregando
(`response.ok()` falso). A resposta veio rápida, não por timeout. Nenhum
documento da factory faz a prévia lançar (testado com 40 mil).

## Passos para reproduzir

1. Rodar a suíte completa (`pnpm test`).

Isolado o teste não falha: passou com `--repeat-each=24`, depois 150 vezes com
`--repeat-each=15`, e passou de novo em 2026-11-01 com `--repeat-each=5` (50 de
50).

## Esperado

A página da prova carrega com status 2xx.

## Obtido

De vez em quando, uma resposta sem `ok`. O status e o corpo não foram
guardados. A mensagem do `expect` agora traz o status e os primeiros 500
caracteres do corpo (`test/islands-no-raw-ids.spec.ts:143`): na próxima falha,
ler ali.
