---
type: issue
status: backlog
tags: [ux, grading, mobile, exams]
relatedTo: [ux-principles, web-grading, grades-table, navigation]
kind: defect
created: 2026-09-29
creator: Fábio Macêdo Mendes
---

# Problemas de UX em aberto

Encontrados percorrendo todas as páginas como aluno, professor e admin, em
1200 px e 390 px. Os princípios P1 a P9 estão em `docs/ux/principles.md`.

## Correção

### Questão de escolha repete enunciado e opções em cada resposta

- Obtido: em `/exams/<slug>/grading/<question>`, a chave de resposta já mostra
  enunciado e opções (`src/pages/[discipline]/[course]/exams/[slug]/grading/[question].astro:145`).
  Cada resposta de escolha mostra a questão inteira de novo
  (`:175`, `src/components/grading/answer-text.ts:34-35`).
- Esperado: a resposta mostra só as opções marcadas, como já acontece com
  respostas curtas, numéricas e dissertativas.

### "Submitted" na página da tentativa é a data da última alteração

- Obtido: o campo usa `attempt.updatedAt`
  (`src/pages/[discipline]/[course]/exams/[slug]/attempts/[username].astro:137`).
  `Response` não guarda o momento da entrega (`prisma/schema.prisma:846`),
  então qualquer escrita posterior muda a data exibida.
- Esperado: a hora real da entrega.

### Tabela de notas mostra "Pending" para prova sem questões

- Obtido: `totalOf` devolve `null` quando não há questões
  (`src/services/exam-result.ts:171`), e a tabela trata `null` como pendente
  (`src/services/grades-table.ts:161-163`).
- Esperado: a célula não sugere trabalho que não existe.

### Coluna que ninguém fez vira "no average · 0 of 4" e "Missed"

- Obtido: o cabeçalho mostra "no average · 0 of N"
  (`src/components/grading/GradesTable.astro:69`) e toda célula vira "Missed"
  (`src/services/grades-table.ts:158`). Fere P2: a coluna não tem nada a fazer.
- Esperado: a coluna diz que ninguém fez a prova, sem repetir "Missed" em
  cada linha.

## Provas

### Prova encerrada sem tentativas oferece "Release results" como ação principal

- Obtido: `gradeReleaseBlocker` permite a liberação de propósito
  (`src/services/exam-state.ts:344`) e a página mostra o botão primário
  (`src/pages/[discipline]/[course]/exams/[slug].astro:452-463`). Fere P2.
- Esperado: decidir se o botão continua como ação principal quando não há
  nada para liberar.

### Prova sem data aparece "Not scheduled" e "Closed" ao mesmo tempo

- Obtido: status `COMPLETED` sem data é `closed`
  (`src/services/exam-state.ts:75`) e o cabeçalho mostra "Not scheduled" ao
  lado do selo "Closed"
  (`src/pages/[discipline]/[course]/exams/[slug].astro:270-274`). Nada diz o
  que encerrou a prova. Fere P3.
- Esperado: o cabeçalho diz por que a prova está encerrada.

### Página do aluno após entregar não mostra hora nem identifica as respostas

- Obtido: o aviso diz só "Submitted. Results are not out yet.", sem horário
  (`src/components/exam/ExamAttempt.tsx:301-305`). As questões aparecem só
  com "Question N of M" (`:338-342`), sem título dizendo que são as respostas
  do próprio aluno.
- Esperado: a hora da entrega e um título como "Suas respostas".

## Navegação

### A aba Students fica em `/roster`

- Obtido: a aba `students` aponta para `${href}/roster`
  (`src/utils/course-tabs.ts:74-78`). Fere P4.
- Esperado: decidir se a URL muda. Renomear quebra links já compartilhados,
  então exigiria redirecionar `/roster`.

O link "Set up the CLI" no menu de todos os usuários está coberto por
`getting-started-out-of-date`.
