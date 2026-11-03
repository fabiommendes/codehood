---
type: issue
status: todo
tags: [api, rpc, grading-bot]
relatedTo: [auto-grading, grading-bot]
kind: enhancement
created: 2026-10-21
creator: Fábio Macêdo Mendes
---

# Webhooks e eventos para bots

## Contexto

Um grading bot precisa consultar a REST API periodicamente para descobrir
submissões novas.

## Requisitos

- R1. O professor registra uma URL de webhook por curso (ou por API key).
  - Aceitação: a URL registrada recebe os eventos do curso.
- R2. O servidor faz um POST assinado (HMAC) em eventos como "submissão
  nova", "prova encerrada" e "pedido de revisão aberto".
  - Aceitação: o bot confere a assinatura com o segredo do webhook e rejeita
    um corpo alterado.

Alternativa mais simples a R1 e R2: um endpoint de long-poll ou SSE na RPC
API.

## A decidir

- Entrega com retentativa (precisa de fila) ou fire-and-forget.
- Quais eventos entram na v1.
