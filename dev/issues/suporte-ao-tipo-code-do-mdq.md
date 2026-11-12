---
type: issue
status: backlog
tags: [questions, mdq, grading]
kind: feature
priority: medium
created: 2026-11-11
creator: claude
---

# Suporte ao tipo `code` do mdq

O pacote `mdq` ganhou o tipo de questão `code` (`mdq-js/CHANGELOG.md`,
"Unreleased"). O Codehood a recusa por enquanto: `questionDocument`
(`src/mdq/index.ts`) rejeita o documento com a mensagem `Question type "code"
is not supported yet.`, na criação e na atualização (API REST, sync da CLI e
service). `QuestionDocument` e os mapas por tipo (`questionTypeLabels`,
`FACTORIES`, `publicQuestionSchema`) não incluem `code`.

Não confundir com a redação com código (`essay` com `content: code`), que
continua como está.

## O que falta para suportar

- Retirar `code` de `UNSUPPORTED_QUESTION_TYPES` e do `Exclude` em
  `QuestionDocument`; o compilador aponta os mapas por tipo que passam a
  exigir a entrada (rótulo e mensagem i18n em `messages/*`, factory, schema
  público).
- Forma pública: `publicForm` de uma questão `code` exige os testes com texto
  (`resolveTests`) e expõe `publicTests` (regiões de exemplo) e `template`.
  Os testes ligados por link (`file`/`origin`) precisam ser resolvidos a partir
  do repositório do curso antes de gravar a questão.
- UI de resposta: o componente `Code` de `mdq/solid` já existe; falta ligá-lo
  em `ExamQuestion` e no preview, e guardar a resposta (rascunho, envio).
- Relatório do runner: a nota vem de `scoreCode` com um `CodeGrading`
  (relatório de testes mais itens manuais da rubrica). O runner no cliente
  (`dev/rfc/ambiente-de-execucao-no-cliente.md`) precisa produzir esse
  relatório no formato esperado e ele precisa ser gravado com a submissão.
  `scoreResponse` recebe o argumento `grading` para esse tipo.
- Monitor de edição: o histórico de edição das respostas
  (`dev/rfc/historico-de-edicao-de-respostas-abertas.md`) segue hoje só questões
  `essay`. Ao aceitar `code`, a página de prova deve alimentá-lo também com as
  edições da resposta de código.
- Correção: a página de correção deve mostrar o gabarito (`referenceSolution`),
  a rubrica completa (`fullRubric`), e deixar o professor marcar os itens
  manuais. Uma resposta sem relatório fica pendente (`NotAutoGradable`).
- Relação com a redação com código: decidir se `essay` + `content: code`
  continua separada ou se migra para `code` quando houver testes.
- `src/db/bootstrap.ts`: semear questões `code` em cada estado.
- Testes: unit para o serviço e a pontuação, e2e para responder e corrigir.
