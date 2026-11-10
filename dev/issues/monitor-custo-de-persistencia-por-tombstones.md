---
type: issue
status: todo
tags: [exam, editor, monitoring, performance]
kind: bug
priority: low
created: 2026-11-10
creator: claude
---

# Custo síncrono por commit do coordenador

## Problema

O monitor deixou de reter teclas recentes, então o checkpoint é proporcional ao
texto e às pendências. Sobram custos fixos no caminho de cada commit, que roda
uma vez por segundo de digitação, por campo sujo:

- `AnswerEditCoordinator.commit` valida o checkpoint e
  `storage.localRecord` valida de novo o mesmo objeto.
- Todo commit bem-sucedido chama `fallback.remove`, que reescreve o JSON de
  todos os campos no `localStorage` de forma síncrona, mesmo sem fallback
  gravado.
- `progressKey` valida o checkpoint de todos os campos a cada volta de
  `flushDelivery`.

## Correção sugerida

Validar o checkpoint uma vez por commit, pular a limpeza do fallback quando ele
está vazio, ler `baseRevision` e `firstSeq` em `progressKey` sem revalidar, e
medir no browser com CPU limitada.
