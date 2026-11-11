---
type: issue
status: backlog
tags: [exam, answer-edits]
kind: bug
priority: medium
created: 2026-11-11
creator: claude
---

# Lacuna do monitor de edição não chega ao servidor

Quando `AnswerEditAdapter` desliga um campo (exceção, rejeição, chave de
desligamento), a lacuna fica só no cliente (`gaps()` e `onGap`). O servidor não
sabe que o histórico daquele campo parou ali e não distingue "o aluno não
digitou mais" de "o monitor morreu".

O coordenador já registra lacunas de rebase só de forma implícita (o primeiro lote
após a nova base não reproduz o texto do servidor). Falta um marcador explícito
no lote ou no endpoint, e o adaptador precisa enviá-lo, com teto, na falha de um
campo. Só faz sentido junto com o endpoint do histórico.
