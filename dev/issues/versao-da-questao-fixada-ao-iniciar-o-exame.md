---
type: issue
status: backlog
tags: [exam, questions, versioning, grading]
kind: bug
priority: high
created: 2026-11-03
creator: claude
---

# Versão da questão não é fixada quando o exame começa

## Problema

Nada fixa a versão das questões de um exame. Um push durante a tentativa troca
a questão sob o aluno e muda a correção.

- `QuestionsForExam.version` guarda o que o cliente mandou, ou `null`
  (`src/core/schemas/exam.ts:42-45`, `src/db/services/exam.service.ts:612`,
  `prisma/schema.prisma:1095`).
- `null` resolve para `QuestionRef.latest` na hora de validar a resposta e de
  corrigir (`src/db/services/submission.service.ts:541`, `:581-583`).
- Reenviar a lista de questões apaga e recria as linhas com `version` do
  payload (`src/db/services/exam.service.ts:350-352`), então um pin gravado
  hoje seria apagado pelo próximo push.

As fontes já foram alinhadas com a decisão abaixo, o código não:
story `instructor#assemble-and-schedule-an-exam`
(`docs/user-stories/instructor.md:269-272`) e `BACKLOG.md:125-129`.
`GLOSSARY.md` (Exam, `:191`) só diz que, sem pin, a questão segue a mais
recente.

## Decisão

O humano decidiu: a versão é fixada quando o exame entra em `ONGOING`.

A fase é derivada do status gravado mais o relógio (`examPhase`,
`src/services/exam-state.ts:58`); um exame `SCHEDULED` abre sozinho na data e
nenhuma transição é gravada. Então, na prática:

- Ao abrir a **primeira tentativa** do exame, na mesma transação, gravar em
  cada `QuestionsForExam` com `version = null` o `versionHash` de
  `QuestionRef.latest`. Questões já fixadas ficam como estão.
- Enquanto o exame está `SCHEDULED` (nenhuma tentativa aberta), pushes
  continuam atualizando a versão servida.

## Proposta

- Carimbar nos dois caminhos que criam tentativa:
  `ResponseService.createTx` (`src/db/services/response.service.ts:156`) e
  `resolveOrCreateAttempt` (`:766`). Fatorar num helper chamado pelos dois.
- Carimbar de forma idempotente e segura sob concorrência: `updateMany` com
  `where: { examId, version: null }`, para que duas primeiras tentativas
  simultâneas não gravem versões diferentes.
- `updateTx`/`upsert` do exame preservam o pin existente de cada questão que
  continua no exame em vez de recriar com `null`.
- Tirar `version` do input de `examQuestionInput`
  (`src/core/schemas/exam.ts:42-45`): `BACKLOG.md:125-127` diz que o pin não
  deve ser definido pelo usuário. Se o humano preferir manter o pin manual,
  ele vence o carimbo.
- Atualizar `GLOSSARY.md` (Exam, Question version) e remover a nota de
  `BACKLOG.md:125-129` quando o carimbo existir.

Exames `PRACTICE` ficam fora do carimbo: estão sempre abertos (`examPhase`,
`src/services/exam-state.ts:62`), e carimbar na primeira tentativa
congelaria a prática para sempre. Uma prática sem pin segue a versão mais
recente.

## Critérios de aceitação

- [ ] Teste de regressão: exame com questão sem pin, aluno abre a tentativa,
      instrutor faz push de nova versão, a resposta é validada e corrigida
      contra a versão do momento da abertura.
- [ ] Push durante `SCHEDULED`, antes de qualquer tentativa, muda a versão
      servida.
- [ ] Exame `PRACTICE` com tentativa aberta passa a servir a versão nova
      depois de um push.
- [ ] Reenviar a lista de questões de um exame em andamento não apaga os pins.
- [ ] Duas aberturas concorrentes gravam o mesmo pin.
- [ ] Glossário e `BACKLOG.md` descrevem o carimbo como feito.
