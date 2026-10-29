---
type: spec
status: review
tags: [mdq, grading, exams, fill-in]
relatedTo: [dev/specs/to-review/mdq-biblioteca.md]
---

# Revisão com marcas da biblioteca e correção por lacuna

## Contexto

A mdq-js dá a nota de cada lacuna (`scoreBlanks`, `QuestionScore.blanks`), o
resultado pendente (`PendingResult`) e a nota de um fill-in com lacunas
corrigidas à mão (`combineBlanks`). No codehood só a prévia do professor usa
isso: a correção e os resultados do aluno mostram a resposta em `readonly`.

## Decisões

1. **`Feedback.blanks`**: coluna `Json?` com `{blankId: {score, comment?}}`,
   nota em [0, 1], só para as lacunas pendentes de um fill-in. A nota da
   questão continua em `Feedback.score`, calculada no servidor por
   `combineBlanks`. Entra na migração do próximo release.
2. **Resultado de revisão** (`src/services/review.ts`, puro): a partir do
   documento, da resposta e da nota gravada, monta o `result` do componente.
   As marcas e o feedback vêm da biblioteca; a nota mostrada é a gravada; uma
   lacuna corrigida à mão recebe a nota do professor e o comentário dele como
   feedback. Sem nota gravada, vale a nota da biblioteca; a resposta só é
   pendente quando a biblioteca não consegue corrigi-la (um componente de
   múltipla escolha não aceita resultado pendente).
3. **Correção**: cada resposta, exceto essay, aparece em modo `review` com as
   marcas, sem a nota da biblioteca (`hideScore`): a nota que vale é a da
   lista de passes. Um fill-in com lacuna pendente troca o campo de nota
   total por nota e comentário por lacuna pendente (ação
   `grading.gradeBlanks`).
4. **Resultados do aluno**: com a nota liberada, cada questão respondida
   aparece em modo `review`, sem gabarito (`correct` fica de fora). O
   documento privado é lido no servidor só para calcular o resultado.
