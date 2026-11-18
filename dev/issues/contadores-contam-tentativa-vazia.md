---
type: issue
status: backlog
tags: [exams, grading]
kind: bug
priority: low
created: 2026-11-17
---

# Contadores de tentativas contam a tentativa vazia

A [tentativa vazia](../../GLOSSARY.md) (criada pelo professor ao ajustar a nota
ou dar nota a uma questão em branco de quem não fez a prova) é uma `Response`
fechada, sem envios e com `createdBy`. Os contadores que não passam por
`question-stats.ts` a contam como entrega real.

## Onde

- `src/services/instructor-home.ts`: `submitted` (provas em andamento) e
  `attempts` em `toRelease` contam a tentativa vazia, porque ela está
  "finalizada" para `isFinished`.
- Outros contadores de "N tentativas" nas listas de provas que somem
  `Response` sem olhar `createdBy`.

`questionStats` e os grupos da correção já filtram (achado 12 da spec
`dev/specs/to-review/correcao-objetivas-e-ajustes-de-nota.md`).

## Efeito

O painel do professor mostra uma entrega a mais que o número de alunos que
fizeram a prova. Só aparece depois que o professor cria a tentativa vazia.

## Correção sugerida

Excluir `createdBy` não nulo sem submissão do aluno nesses contadores, com o
mesmo critério de `question-stats.ts`.
