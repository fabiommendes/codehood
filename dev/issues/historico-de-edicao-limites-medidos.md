---
type: issue
status: backlog
tags: [exam, answer-edits, performance]
kind: debt
priority: low
created: 2026-11-17
creator: claude
---

# Histórico de edição: dois limites não fecham com o medido

Medição de 2026-11-12 (`scripts/measure-answer-history.ts`, digitador
simulado com semente fixa alimentando o `AnswerEditMonitor` real; 12 núcleos,
bancos em tmpfs, valores em mediana e p95). Decisão na época: limites
mantidos, os dois problemas abaixo aceitos como conhecidos. Desenho em
`dev/rfc/historico-de-edicao-de-respostas-abertas.md`.

## 1. `byteCount` conta o `snapshot` de cada lote

`answer-edit.service.ts` (`measure`) conta contra o limite da tentativa
(`MAX_ANSWER_HISTORY_ATTEMPT_BYTES`, 4 MiB) o JSON inteiro de cada lote,
`snapshot` incluído, mas a linha só guarda o último `snapshot` (na âncora). O
`snapshot` é 48% a 56% do `byteCount` nos perfis normais e 64% no envelope do
RFC.

| Perfil | `byteCount` | Páginas no SQLite |
| :-- | :-- | :-- |
| redação de 300 palavras | 17,9 KiB (20,8) | 12 KiB |
| código de 60 linhas, 3 colagens | 38,7 KiB (49,9) | 24 KiB |
| prova de 88 min, 5 abertas | 111 KiB (126) | 64 KiB |
| prova pesada | 198 KiB (244) | 128 KiB |
| envelope do RFC (10 edits/s, 90 min) | 3.821 KiB, 93,5% dos 4 MiB | 1.504 KiB |

O envelope do RFC deveria usar uns 50% do limite. Nesse ritmo, uma prova de
mais de uns 94 min fecha o histórico. Proposta: contar só o que a linha guarda
(`edits`, `baseText`, `gapBefore`); o envelope cai para uns 1,4 MiB, 35% do
limite. Alternativa pior: subir o limite para 8 MiB, deixando a conta
enganosa.

## 2. Maior lote permitido passa da meta de 50 ms

Validação fora da transação, 5.000 edits (`MAX_ANSWER_HISTORY_BATCH_EDITS`)
de 1 caractere sobre 120 KB: 64 a 66 ms (p95 68 a 72), 62 ms no replay. O
replay copia a string a cada edit (cerca de 0,5 ns por caractere vezes edits
vezes tamanho do texto). Sobre 60 KB com edits de 50 caracteres: 37 ms; sobre
4 KB: 6,9 ms. O lote típico tem 17 edits (p95 27) e leva 0,026 ms.

Proposta: baixar `MAX_ANSWER_HISTORY_BATCH_EDITS` para 3.000 (estimativa: 37
ms no pior caso). Relacionado: uma chamada aceita 2 MiB, uns cinco lotes
máximos, o que dá até uns 330 ms de laço de eventos (estimado, não medido).

## Não medido

Firefox e WebKit; rede real e disco de produção; digitação humana real; custo
do monitor por tecla e da persistência local no navegador.
