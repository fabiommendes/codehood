---
type: issue
status: backlog
tags: [schedule, ui, navigation]
kind: enhancement
priority: medium
created: 2026-11-16
creator: claude
---

# A agenda de um curso longo perde o foco no trabalho à vista

A página `<curso>/schedule` e o card dela na sidebar listam todas as semanas do
curso. Numa disciplina de 15 semanas ou mais, a lista fica longa: o card mostra
"Past weeks" e mais uma entrada por semana até o fim, e a página empilha
semanas distantes ao lado da semana atual. A mesma lista agora aparece também
na chamada (`roll-call/[week]/[timeSlot]`) e nos recursos de evento, porque a
sidebar é estável dentro da aba (`src/utils/load-schedule-nav.ts`).

O usuário validou o card da aba Agenda assim mesmo, mas achou a página confusa
para um curso longo.

## O que repensar

- A pergunta da página é "o que acontece nesta semana e nas próximas?". O
  passado e o futuro distante são consulta, não trabalho.
- Opções a avaliar:
  - mostrar a semana atual e as duas ou três seguintes, com as demais recolhidas
    num "mais semanas" (como "Past weeks" já faz com o passado);
  - agrupar o card por mês ou por unidade do curso em vez de por semana;
  - dar ao card só âncoras para "Esta semana", "Próximas" e "Anteriores".
- O card continua igual em todas as páginas da aba (regra da sidebar estável).
- A home do curso já mostra "Esta semana"; a agenda não deve repetir a home, e
  sim estendê-la.

## Relacionadas

- `dev/specs/to-do/card-de-navegacao-do-curso.md`
