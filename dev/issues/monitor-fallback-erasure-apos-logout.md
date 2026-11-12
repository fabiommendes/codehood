---
type: issue
status: todo
tags: [exam, editor, monitoring, privacy]
kind: bug
priority: low
created: 2026-11-10
creator: claude
---

# Logout do monitor: retry da revogação do IndexedDB

O limite do fallback em `localStorage` (texto órfão sob a chave antiga, rotação
simultânea de tokens) deixou de existir: o monitor não tem mais fallback.

## Aberto

`EditStore.revoke()` do IndexedDB memoriza a Promise, inclusive rejeitada, e
fecha o banco ao terminar. Se a revogação falhar, repetir
`AnswerEditCoordinator.logout()` devolve a mesma rejeição e não tenta de novo.

Correção: não memorizar a falha em `revoke()` e reabrir a conexão no retry, ou
documentar que a falha do IndexedDB exige recarregar a página.
