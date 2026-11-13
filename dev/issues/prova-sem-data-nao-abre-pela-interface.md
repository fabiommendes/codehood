---
type: issue
status: backlog
tags: [exams, instructor, ui, schedule]
kind: defect
priority: high
created: 2026-11-13
creator: claude
---

# Prova sem data de abertura não pode ser aberta pela interface

Visto em produção (codehood.dev, `v0.4.0`) em 2026-11-13. A prova `teste2-elm`
(`QUIZ`) do curso `paradigmas/chips_2026-2` chegou pela CLI com `status: DRAFT`,
`scheduledAt: null` e `duration` de 1h40. O professor não tinha como abri-la
pela interface. Ela foi agendada pela REST:

```
PATCH /api/course/paradigmas/chips_2026-2/exam/teste2-elm
{"scheduledAt": "2026-11-13T17:00:00.000Z", "duration": {"hours": 5}, "status": "SCHEDULED"}
```

## O que falta

- `src/actions/exam.ts` não tem ação para mudar `scheduledAt`, `duration` ou
  `status` de uma prova (só `start`, `finish`, `releaseGrades`,
  `setAnswerHistory` e as exceções).
- `exams/[slug].astro` não mostra campo de data, de duração nem de status.
  Uma prova em `DRAFT`, ou sem data, fica parada até alguém usar a REST.

## Observação sobre o modelo

Com data e duração, a janela é uma só para toda a turma: abre em
`scheduledAt` e fecha em `scheduledAt + duration` (`attemptDeadline` em
`src/services/exam-state.ts`). Não dá para expressar "abre das 14h às 19h e
cada aluno tem 1h40 a partir de quando começa". Para abrir a prova das 14h às
19h, a duração de 1h40 foi trocada por 5h.

## Critérios de aceite

- O professor agenda uma prova (data, duração) e a tira de `DRAFT` pela
  página da prova.
- A página avisa quando a prova está em `DRAFT` ou sem data.

Relacionada: `dev/issues/pagina-da-prova-do-professor-precisa-ser-retrabalhada.md`.
