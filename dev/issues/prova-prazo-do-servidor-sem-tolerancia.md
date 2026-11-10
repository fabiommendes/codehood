---
type: issue
status: todo
tags: [exam, student, deadline, policy]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Prazo do servidor recusa o último salvamento sem tolerância

Confirmado por leitura. Depende de decisão de política.

## Problema

`assertAcceptingSubmissions` recusa com `now > deadline`
(`src/db/services/submission.service.ts:534`). Um salvamento enviado antes do
prazo, mas que chega depois (latência, retry, relógio do cliente com desvio),
é recusado e a resposta se perde.

## Passos

1. Aluno edita uma resposta nos últimos segundos, com rede lenta.
2. O request chega 1 s depois do prazo.

## O que o aluno vê e o servidor guarda

O cliente mostra falha de salvamento e o aviso de respostas que não chegaram
ao servidor. O servidor guarda a versão anterior.

## Direção

Decidir uma tolerância (por exemplo 5 a 15 s) só para `response.submit`, ou
aceitar o que o cliente carimba como enviado antes do prazo, dentro de uma
janela. A decisão é de produto: afeta a justiça entre alunos e a regra de
`acceptingSubmissions`. O cliente já drena o pendente com antecedência, o que
reduz mas não elimina o caso.
