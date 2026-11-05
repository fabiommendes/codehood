---
type: issue
status: backlog
tags: [exam, grading, questions, schema]
kind: feature
priority: medium
created: 2026-11-05
creator: claude
---

# Peso da questão por prova

## Problema

O total de uma prova pondera cada questão pelo `weight` da versão que a prova
fixou (frontmatter da questão, padrão 1). A mesma questão, usada em duas
provas, tem o mesmo peso nas duas. Em uso real o professor precisa de pesos
diferentes por prova: uma questão vale 3 numa prova curta e 1 numa longa.
Hoje a saída é duplicar a questão, o que separa as estatísticas e o histórico
das cópias.

O Moodle trata o peso assim: é da questão dentro do quiz, não da questão do
banco.

## Proposta

- `QuestionsForExam.weight Float?`: quando preenchido, sobrepõe o peso da
  questão só naquela prova; `null` usa o `weight` da questão. Não negativo.
- `examQuestionInput` (`src/core/schemas/exam.ts`) aceita `weight` opcional;
  `examQuestionSchema` devolve o peso efetivo e se ele veio da prova.
- `services.examResult` (`src/services/exam-result.ts`) já recebe o peso por
  questão; só muda quem o calcula.
- CLI: quando o mdq aceitar `weight` no `include` (issue
  `mdq/dev/issues/peso-da-questao-sobrescrito-no-include-da-prova.md`), o push
  de provas envia o campo. Até lá, só pela REST.

## Cuidados

- Mudar o peso de uma prova já corrigida muda as notas de todos os alunos
  sem criar versão nova de nada. Decidir se isso exige confirmação na tela ou
  fica registrado.
