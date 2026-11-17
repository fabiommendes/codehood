---
type: issue
status: backlog
tags: [grading, questions, exams]
kind: bug
priority: medium
created: 2026-11-17
creator: claude
---

# Fixar outra versão da questão não refaz a correção automática

Quando o gabarito de uma questão objetiva está errado, o professor corrige a
questão e fixa a nova versão na prova. As respostas que já têm uma correção
automática (`auto`) continuam com a nota calculada pelo gabarito antigo.

`gradeObjectives` (`src/db/services/objective-grading.ts`) só corrige as
submissões que ainda não têm correção. Ele roda na entrega
(`response.service.ts`), no encerramento da prova (`exam.service.ts`) e em
`settleExpired`, que `loadExamGrading` (`src/utils/load-grading.ts`) chama a cada
carregamento das páginas de correção. Nenhum desses caminhos volta a corrigir
uma submissão que já tem uma correção `auto`.

## Como reproduzir

1. Uma prova com uma questão de múltipla escolha, gabarito errado, versão `v1`.
2. Alunos entregam; cada resposta ganha uma correção `auto` com a nota de `v1`.
3. O professor corrige o gabarito, publica `v2` e fixa `v2` na prova.
4. A página de correção da questão mostra as notas de `v1`.

## O que decidir

- Recorrigir ao trocar a versão fixada, com uma nova correção `auto` que não
  apague o histórico, ou oferecer um botão "recorrigir" na página da questão.
- O que fazer com uma resposta cuja correção mais recente é manual: manter a
  manual parece o certo.
