---
type: issue
status: backlog
tags: [seed, attendance, check-in]
kind: enhancement
priority: low
created: 2026-11-18
creator: claude
---

# O seed não tem chamada aberta, e o check-in com sucesso nunca aparece

O tour das telas (`pnpm run test:tour`) lista dois componentes que nenhuma
página renderiza com os dados do seed:

- `src/components/check-in/AttendanceResult.astro`: a presença registrada,
  depois de um código aceito em `/check-in` ou em `/c/<rollCallId>/<code>`;
- `src/components/check-in/SignUpForm.astro`: o cadastro de quem chega sem
  conta por uma chamada que vale como convite (`actsAsInvite`).

As duas telas só existem enquanto uma chamada está aberta. O seed
(`seedRollCall` em `src/db/bootstrap.ts`) fecha cada chamada 15 minutos depois
do início do encontro (`closesAt: at(15)`), e os encontros semeados são todos
passados, salvo o "Office hours" de hoje às 22h, que ainda não tem chamada.
Então, no dev e no tour, todo código é recusado com "This roll call is closed".

## O que fazer

- Semear uma chamada aberta no momento do seed: a do encontro de hoje, aberta
  e com `closesAt` algumas horas à frente, com `actsAsInvite: true` para que o
  cadastro também apareça.
- Conferir no tour que `AttendanceResult` (aluno com o código certo) e
  `SignUpForm` (visitante com o código certo) passam a ser renderizados. As URLs
  com o código da vez já são geradas em `test/tour/starts.ts` (`rollCallUrl`),
  que escolhe a chamada que fecha por último.
