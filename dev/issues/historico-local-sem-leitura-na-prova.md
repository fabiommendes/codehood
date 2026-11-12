---
type: issue
status: backlog
tags: [exam, answer-edits]
kind: feature
priority: low
created: 2026-11-11
creator: claude
---

# Histórico local da prova não é lido nem enviado

A página de prova registra o histórico de edição no navegador quando
`localStorage["codehood.answerHistory"]` vale `"on"`, mas o transporte do
coordenador (`src/components/exam/answer-edit-session.ts`) falha de propósito: não
há endpoint. O histórico fica em IndexedDB até expirar (14 dias) e ninguém o lê.

Falta, junto com o endpoint: trocar a chave local por configuração por prova
vinda do servidor (R6) e enviar o histórico e a lacuna do monitor. Os tipos
`numeric` e `fill-in` ficam de fora (só `essay` e `short-answer` são seguidos), e o
monitor vê o editor de código apenas por `change()`, sem distinguir colagem.
