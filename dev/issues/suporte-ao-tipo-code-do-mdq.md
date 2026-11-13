---
type: issue
status: todo
tags: [questions, mdq, exam, answer-history, code]
relatedTo: [teste-de-carga-da-prova]
kind: feature
priority: high
created: 2026-11-11
creator: claude
---

# Questões `code` do mdq fora do monitor de edição

O Codehood já aceita o tipo `code` do mdq: a questão é corrigida por workers
externos (`CHANGELOG.md`, "Questões `code` corrigidas por workers externos"),
abre no editor da prova (`CodeAnswer`) e é semeada em `src/db/bootstrap.ts`
(`seedExternalGradingExams`). Falta uma parte: o monitor de edição.

## Problema

O histórico de edição das respostas
(`dev/rfc/historico-de-edicao-de-respostas-abertas.md`) segue só questões
`essay`, o que inclui a redação com código (`essay` + `content: code`,
`CodeEssayAnswer`) mas deixa de fora o tipo `code`:

- `historyQuestions` em `src/components/exam/ExamAttempt.tsx` filtra
  `entry.question.type === "essay"`, então o adapter nunca é ligado às
  questões `code`;
- `recordEdit`, no mesmo arquivo, retorna cedo quando `type !== "essay"`.

O RFC deixou o `code` para "quando o Codehood passar a aceitá-lo". Ele passou
a aceitar, mas o monitor não acompanhou. Na `teste2-elm` (2026-11-13), toda a
prova era de questões `code`, e nenhuma edição foi registrada: só ficaram as
respostas salvas pelo autosave e os envios.

É nas questões de código que deve estar boa parte das colas com IA (texto
colado de uma vez, saltos grandes sem digitação), que é justamente o que o
histórico de edição existe para mostrar. Sem ele, a ferramenta não cobre o
caso que mais importa.

## O que fazer

- Incluir as questões `code` em `historyQuestions` e em `recordEdit`.
- Conferir que `CodeAnswer` passa cada edição por `change()` com o
  `userEvent` do CodeMirror (digitação, colagem, desfazer), como faz
  `CodeEssayAnswer`, para que `kindOfUserEvent` classifique as entradas.
- Conferir que o envio (`SUBMIT`) não interfere no histórico: o envio grava
  a mesma resposta que o autosave, e o histórico continua depois dele.
- `removeSettledHistory` e a página do resumo do histórico
  (`answer-edit-summary`) devem cobrir as questões `code`.
- `src/db/bootstrap.ts`: semear histórico numa questão `code` (por exemplo
  na `test-elm`), com digitação e uma colagem, para que a página do
  professor mostre o caso.
- Testes: e2e de uma prova com questão `code` e o switch ligado, conferindo
  que as edições chegam ao servidor, com a colagem classificada como tal.

## Efeito na carga

Respostas de código são longas e editadas o tempo todo, então ligar o monitor
nelas aumenta as escritas por aluno durante a prova. O teste de carga
(`teste-de-carga-da-prova.md`) deve medir o cenário de monitoramento com o
histórico ligado nas questões `code`.

## Em aberto

- Decidir se a redação com código (`essay` + `content: code`) continua
  separada ou migra para `code` quando houver testes.
