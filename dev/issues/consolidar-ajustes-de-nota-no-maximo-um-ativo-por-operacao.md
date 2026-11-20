---
type: issue
status: backlog
tags: [notas, provas]
relatedTo: [correcao-objetivas-e-ajustes-de-nota, feedback-e-notas-do-professor-na-prova-inteira]
kind: enhancement
created: 2026-11-19
creator: claude
---

# Consolidar ajustes de nota: no máximo um ativo por operação

## Problema

No total da prova, o servidor aceita qualquer número de `FACTOR` e de `OFFSET`
ativos para o mesmo aluno (`src/db/services/exam-adjustment.service.ts`, regra
em `create`: só `SET` e o ajuste por questão são únicos). Em
`src/services/exam-result.ts` os fatores se multiplicam e os deslocamentos se
somam.

Isso gerou um erro real em 2026-11-19, na `prova-1` de
`paradigmas/chips_2026-2`: um script rodou duas vezes e gravou 45 pares de
ajustes idênticos (`FACTOR 0` e `FACTOR 1`). Nenhuma das duas vezes foi
recusada. Os pares foram apagados direto no banco, porque revogar deixa a
linha guardada e a API não tem rota de apagar.

Dois ajustes de tipos diferentes juntos fazem sentido: um fator multiplicativo
e um deslocamento aditivo. Dois do mesmo tipo em sequência não fazem: deviam
virar um ajuste só, com o valor combinado e o histórico guardado.

## Proposta

- No máximo um ajuste ativo de cada operação (`SET`, `FACTOR`, `OFFSET`) por
  tentativa no total da prova, como já vale para `SET`.
- Um segundo `FACTOR` ou `OFFSET` consolida com o ativo, ou é recusado com
  `not-unique` e o cliente usa `PATCH`. Decidir qual dos dois.
- Investigar a arquitetura antes de mudar: a ordem de aplicação (`SET`, depois
  `FACTOR`, depois `OFFSET`), a interação com o `FACTOR` por questão, a
  limpeza dos dados que já têm vários ajustes do mesmo tipo e o que o aluno vê
  quando um ajuste substitui outro.

## Decisões abertas

- Consolidar no servidor (multiplicar fatores, somar deslocamentos, guardar o
  anterior como revogado) ou recusar e exigir edição.
- Se o motivo e as notas do ajuste consolidado se juntam ou se substituem.
- Se a criação deve ser idempotente: o mesmo corpo repetido devolve o ajuste
  existente em vez de criar outro.
