---
type: issue
status: backlog
tags: [notas, provas]
relatedTo: [correcao-objetivas-e-ajustes-de-nota]
kind: enhancement
created: 2026-11-19
creator: claude
---

# Feedback e notas do professor na prova inteira

Hoje o feedback e as notas do professor existem por questão (`Feedback.feedback`
e `Feedback.notes`, ligados a uma `Submission`), e na prova inteira só existe o
`ExamAdjustment`, que sempre mexe no total. Falta um lugar para texto da prova
inteira, sem efeito na nota.

## Casos

- Feedback da prova para o aluno: um comentário geral sobre a tentativa,
  visível depois da liberação das notas, além do feedback de cada questão.
- Notas pessoais do professor sobre a tentativa: nunca visíveis ao aluno. Uso
  real na Prova 1 de Paradigmas (2026-2): registrar suspeita de cola que não
  bastou para anular a prova, para considerar se o mesmo aluno aparecer de novo
  em outra prova.

## Contorno atual

Para a suspeita, um `ExamAdjustment` com `op: FACTOR`, `value: "1"` e só
`notes`. Não muda a nota, mas a tela do aluno (`ExamAttempt.tsx`, com o rótulo
de `src/utils/adjustment-label.ts`) mostra "Bônus ×1", sem motivo.

## O que decidir

- Onde guardar: campos na tentativa (`Response`, ou o modelo da tentativa da
  prova) ou um modelo próprio com autor e data, como o `ExamAdjustment`.
- Se as notas do professor aparecem juntas na ficha do aluno no curso, para
  ver o histórico de todas as provas (o caso da suspeita depende disso).
- Rotas REST e CLI para criar e ler, como as do ajuste.
- Enquanto isso não existe, se a tela do aluno deve esconder ajustes sem efeito
  (`FACTOR 1`).
