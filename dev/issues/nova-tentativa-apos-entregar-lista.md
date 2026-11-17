---
type: issue
status: backlog
tags: [exams, practice]
kind: bug
priority: medium
created: 2026-11-17
creator: claude
---

# Entregar uma lista não libera uma nova tentativa

## Problema

Uma lista (`PRACTICE`) abre uma tentativa por sessão. A sessão dura
`PRACTICE_SESSION_WINDOW_MS` (12h) e aponta para a tentativa que criou. Depois
de "Entregar" (`response.finish` fecha a tentativa mais recente), qualquer envio
dentro da mesma janela cai na tentativa fechada e é recusado ("not accepting new
submissions"). O aluno só consegue começar outra tentativa quando a janela
acaba.

## Esperado

Entregar uma lista encerra a sessão: o próximo envio, ou um botão "Nova
tentativa", abre uma tentativa nova na hora.

## Onde olhar

- `resolveOrCreateAttempt` em `src/db/services/response.service.ts`: escolhe a
  tentativa da sessão e não olha `acceptingSubmissions`.
- O `submit` não repassa `practiceSession`.
- A página da prova (`src/pages/[discipline]/[course]/exams/[slug].astro`) lê
  a tentativa mais recente e mostra o estado "entregue".
