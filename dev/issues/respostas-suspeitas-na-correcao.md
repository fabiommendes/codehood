---
type: issue
status: backlog
tags: [grading, exams, ui]
kind: enhancement
priority: low
created: 2026-11-17
creator: claude
---

# Respostas suspeitas na correção de questões objetivas

O mockup da correção de objetivas
(`src/pages/design/playground/correcao-objetivas/_Frame.astro`) tem, em
"Requer atenção", uma linha de **resposta suspeita** com dois botões de
ícone: `eye-off` ("Ignorar") e `gavel` ("Aplicar sanção", que abre o diálogo
de ajuste com alvo na questão). A spec
`dev/specs/to-do/correcao-objetivas-e-ajustes-de-nota.md` deixou isso de fora:
o código não tem detector de suspeita nem lugar para guardar o "ignorado".

## O que decidir

- O critério de suspeita. Candidatos: distrator escolhido por quem vai bem no
  resto da prova (a coluna "Marcação" já calcula isso por grupo); sinais de
  bots de correção em `Feedback.notes` (texto livre hoje); resposta idêntica
  a de outro aluno; histórico de edição incomum.
- Onde guardar o "ignorado": por resposta e por professor, para a linha não
  voltar. Um campo ou model novo.
- Se "Aplicar sanção" reaproveita o diálogo de ajuste (`FACTOR < 1`, alvo na
  questão).
