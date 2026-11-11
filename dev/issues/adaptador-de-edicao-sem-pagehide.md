---
type: issue
status: backlog
tags: [exam, answer-edits]
kind: feature
priority: low
created: 2026-11-11
creator: claude
---

# Adaptador de edição não reage a `pagehide`

`AnswerEditAdapter` agenda a gravação local (`persist`) no coordenador, com atraso
de 1 s, e só força `persist`/`flush` em `flushFinal`. Se o aluno fecha a aba ou o
navegador cai nesse intervalo, o último segundo de digitação do histórico se
perde (a resposta em si não, pois vai por `exam.answer`).

Ao integrar com a página de prova, chamar o coordenador em `pagehide` e
`visibilitychange` (hidden), sem aguardar, e sem nunca atrasar o descarregamento.
