---
type: issue
status: todo
tags: [exam, editor, monitoring, privacy]
kind: bug
priority: low
created: 2026-11-10
creator: claude
---

# Logout do monitor: limite do fallback e retry do IndexedDB

## Limite residual aceito

`createTextRecoveryStore` usa um token por owner no `localStorage`. Os dados
ficam sob uma chave derivada do token. `revoke()` rotaciona o token e remove a
chave da geração atual. Depois de cada `setItem`, o escritor relê o token e,
se mudou, remove a própria escrita e lança erro.

Sobra um caso que `localStorage` não permite fechar: um escritor suspenso entre
a checagem e o `setItem` que morre antes de compensar deixa texto órfão sob a
chave antiga. Sessões novas não conseguem lê-lo, mas ele não é apagado
fisicamente. Sem CAS, duas rotações simultâneas também podem invalidar a
sessão mais nova (o texto dela não é apagado, só o handle deixa de gravar).

Não há enumeração do origin nem `Storage.clear()`, de propósito.

## Aberto

`EditStore.revoke()` do IndexedDB memoriza a Promise, inclusive rejeitada, e
fecha o banco ao terminar. `AnswerEditCoordinator.logout()` já repete a limpeza
do fallback depois de uma falha, mas se a revogação do IndexedDB falhar, repetir
o logout devolve a mesma rejeição e não tenta de novo.

Correção: não memorizar a falha em `revoke()` e reabrir a conexão no retry, ou
documentar que a falha do IndexedDB exige recarregar a página.
