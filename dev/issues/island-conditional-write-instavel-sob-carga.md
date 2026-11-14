---
type: issue
status: todo
tags: [tests, flaky]
kind: bug
priority: low
created: 2026-11-14
creator: claude
---

# `island-conditional-write.spec.ts` falha de vez em quando na suíte completa

## Problema

Em 2026-11-14, duas rodadas de `pnpm test` falharam com um único teste
vermelho, as duas em `test/island-conditional-write.spec.ts`:

- linha 185, "rubric editor: two value changes in a row on one page both go
  through": `expect.poll(stored).toBe("0.4")` recebeu `"0.3"` depois de 5 s.
- linha 123, "rubric grader: revising a saved answer twice in a row works…".

O arquivo sozinho, com `TEST_E2E_WORKERS=1`, passou nas quatro vezes em que
foi rodado. As mudanças em curso nas duas rodadas (contexto do log de
performance, paginação das listas) não tocam rubrica nem escrita condicional.

## Hipótese

Tempo: o segundo clique em "Apply changes" chega antes de a ilha receber o
`updatedAt` da primeira escrita, ou antes de hidratar. Não investigado.

## Critérios de aceitação

- [ ] Causa identificada: teste que não espera o que devia, ou a ilha que
  perde a segunda escrita quando o usuário é rápido.
- [ ] O arquivo passa 20 vezes seguidas com a suíte completa em paralelo.
