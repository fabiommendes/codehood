---
type: issue
status: todo
tags: [exam, editor, monitoring]
kind: bug
priority: high
created: 2026-11-10
creator: claude
---

# Pendência acima de 2 MiB bloqueia o envio para sempre

## Problema

`AnswerEditCoordinator.sendPending` só envia campos com `durability === "durable"`.
O registro local tem teto de 2 MiB (`MAX_LOCAL_RECORD_BYTES` em
`src/services/answer-edits/storage.ts`). Quando o checkpoint passa do teto, o
commit principal falha, o campo cai para `text-only` e deixa de ser enviado.

Como só o envio seguido de ACK reduz o checkpoint, o campo não se recupera
sozinho: grande demais para gravar, logo não envia, logo continua grande. O mesmo
vale para qualquer falha permanente do IndexedDB (indisponível, quota, modo
privado): o servidor nunca recebe o histórico nem o texto por este canal.

O teste `oversized pending history preserves text and replay but cannot send
without durable primary storage` em `test/answer-edit-retention-load.spec.ts`
fixa esse comportamento como esperado. Vinte colagens de 128 KiB em dois
segundos bastam. Um aluno offline por alguns minutos com colagens médias chega
ao mesmo ponto.

## Por que é defeito e não degradação

A regra "outbox durável antes da rede" existe para que um retry após crash
reenvie o mesmo lote. Quando a gravação local é impossível, segurar o envio
troca um risco pequeno (lote reenviado com outro conteúdo após crash, que o
servidor já precisa recusar por `batchId`) por uma perda certa: o histórico fica
só em memória e some no reload. O servidor é o armazenamento mais durável
disponível e é justamente o que fica sem os dados.

## Correção sugerida

- Enviar o lote congelado em memória quando o commit principal falhar, marcando
  o status como não durável. Após crash, a reconciliação com os recibos do
  servidor já cobre o caso.
- Limitar o tamanho do lote em vez do registro: `collect` com teto de bytes e
  drenagem em vários envios.
- Rever o teto de 2 MiB. Ele é uma escolha da implementação, o IndexedDB aceita
  muito mais.
