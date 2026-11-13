# Prova não guarda nem aplica a política de correção do MDQ

O MDQ declara na prova três campos que o servidor ignora:

- `penalty`: `"none" | "capped" | "full"` (padrão `"none"`)
- `grading`: `GradingStrategy` ou `{tipoDeQuestão: GradingStrategy}` (padrão
  `"symmetric"`; tipos em `mdq-py/mdq/types.py`, `ExamGrading`)
- `shuffle`: `bool` (padrão `false`)

`Exam` não tem coluna para eles e nada no servidor os aplica. Hoje o `ch push`
de provas (spec `cli/dev/specs/to-do/push-exams.md`) só avisa quando o arquivo
traz valor diferente do padrão e não envia nada.

## Proposta combinada

- Coluna `Exam.policy Json?` com `{penalty?, grading?, shuffle?}`, validada
  por zod espelhando os tipos do mdq. `null` = padrões do MDQ.
- `policy` em `ExamCreate`/`ExamUpdate`/`Exam`; dono é o repositório (ADR 0012):
  ausente no PUT limpa.
- O servidor aplica a política: `penalty`/`grading` na correção
  (`src/services/exam-result.ts` e o cálculo da nota das questões objetivas),
  `shuffle` na ordem das questões que o aluno vê, estável por tentativa.
  Gravar sem aplicar está fora: o aluno seria corrigido diferente do que o
  arquivo diz.
- A spec precisa dizer como a `penalty` da prova convive com o desconto por
  envio das questões `code` (`QuestionRef.penalty`, R12 da spec da fila de
  correção externa).
- Fim: `pnpm run openapi:cli`; a CLI passa a enviar `policy` e o inclui no `rev`.

`attachments` também falta e fica fora: são arquivos e pedem outro desenho.

## Quando

Depois da release de 2026-11-13 e da prova-teste de 2026-11-14 (decisão da
sessão `codehood`, de acordo com a CLI).
