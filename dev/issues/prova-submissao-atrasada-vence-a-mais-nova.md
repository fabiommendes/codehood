---
type: issue
status: todo
tags: [exam, student, api, ordering]
kind: bug
priority: medium
created: 2026-11-10
creator: claude
---

# Submissão atrasada vale mais que a resposta mais nova

Confirmado por teste (`test/exam-delivery.spec.ts`, "an old request that lands
late does not replace the newer answer").

## Problema

As submissões são append-only e vale a mais recente por ordem de chegada ao
servidor. Quando um request de salvamento estoura o timeout do cliente (15 s)
e o cliente envia uma resposta mais nova, o request antigo ainda pode chegar
depois e passa a ser a resposta que conta.

## Passos

1. Aluno digita A, o request fica pendurado.
2. Aluno digita B. Passado o timeout, B é enviado e confirmado.
3. O request de A chega ao servidor.

## O que o aluno vê e o servidor guarda

A tela mostra B como salva. O servidor guarda A como a última submissão.

## Paliativo no cliente

Quando o request que estourou o timeout responde com sucesso e o payload dele
difere da resposta atual, o cliente reenvia a resposta atual pela mesma fila e
marca a questão como não salva até confirmar (`landedLate` em
`src/components/exam/ExamAttempt.tsx`).

Limites: se a aba fechar entre a chegada tardia de A e o reenvio de B, o
servidor fica com A. Se A chegar antes do prazo e o reenvio de B depois, o
servidor recusa B e fica com A; o cliente mostra o aviso de resposta não
entregue só se ainda estiver aberto.

## Direção

Solução definitiva no servidor: o cliente envia um número de sequência por
questão (crescente por aba e questão) e `response.submit` ignora a submissão
cujo número seja menor que o já gravado. Precisa de campo novo em
`Submission` (migração, decisão do humano) e no schema `examAnswer`.
