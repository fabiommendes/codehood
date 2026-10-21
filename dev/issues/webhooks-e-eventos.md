---
type: issue
status: todo
tags: [api, rpc, grading-bot]
relatedTo: [auto-grading, grading-bot]
---

# Webhooks e eventos para bots

Um grading bot precisa consultar a REST API periodicamente para descobrir
submissões novas.

Ideia: o professor registra uma URL de webhook por curso (ou por API key) e o
servidor faz um POST assinado (HMAC) em eventos como "submissão nova",
"prova encerrada" e "pedido de revisão aberto". Alternativa mais simples: um
endpoint de long-poll ou SSE na RPC API.

A decidir: entrega com retentativa (precisa de fila) ou fire-and-forget;
quais eventos entram na v1.
