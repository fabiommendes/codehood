---
type: issue
status: todo
tags: [exam, editor, monitoring]
kind: bug
priority: high
created: 2026-11-10
creator: claude
---

# Checkpoint do monitor é rejeitado por arredondamento de ponto flutuante

## Problema

Com relógio fracionário (`performance.now()` real), cerca de 0,1% das chamadas de
`AnswerEditMonitor.collect()` produzem um checkpoint que o próprio
`parseCheckpoint` recusa com `pending edit exceeds active clock`. Os testes usam
tempos inteiros e não cobrem o caso.

Causa: `encodeEdits` grava `startMs - previousStartMs` e a validação reconstrói
`previousStartMs + delta`. Em IEEE-754, `(a - b) + b` nem sempre é `a`. Para o
lote em trânsito da sessão ativa, `validateReplay` em
`src/services/answer-edits/checkpoint.ts` compara o início reconstruído com
`active.lastAtMs` usando `<=` exato. Um ulp acima basta para rejeitar.

## Consequência

`AnswerEditCoordinator.commit` chama `parseCheckpoint` fora do `try`. O campo
entra num estado sem saída:

- `persist()` e `flush()` rejeitam em toda tentativa, enquanto o lote estiver em
  trânsito. O lote nunca é enviado, então nunca sai de trânsito.
- Nada é gravado: nem IndexedDB, nem o fallback de texto. O status fica em
  `pending`, sem `error`, e as chamadas disparadas pelo scheduler viram
  `unhandledRejection`.
- Um reload perde tudo desde o último commit bem-sucedido. `restore` do mesmo
  checkpoint também falha.

## Reprodução

Origem da sessão em `1275.9215121045345`, uma inserção de digitação em
`104877.03408602487`, depois `collect()` e `parseCheckpoint(exportCheckpoint())`.
No coordenador, com store e transporte em memória, três `flush()` seguidos
rejeitam e `send` nunca é chamado.

Em 20.000 sessões aleatórias com origem entre 300 e 2.300 ms e edits entre 1 e
50 minutos depois, 17 falharam. Com origem e eventos próximos (razão menor que
2) a subtração é exata e o defeito não aparece, o que explica os testes verdes.

## Correção sugerida

- Escolher uma representação em que o roundtrip seja exato. Opções: tempos
  inteiros (arredondar na entrada do monitor, o que também responde à pergunta
  Q5 do RFC), ou guardar no lote os tempos absolutos e derivar os deltas só no
  transporte.
- Validar a ordem do relógio sobre os valores decodificados, nunca misturando
  valor original e valor reconstruído.
- Mover `parseCheckpoint` de `commit` para dentro do `try`, para que uma falha
  de validação caia no fallback de texto com erro visível.
- Teste de propriedade com tempos fracionários e origem distante dos eventos.
